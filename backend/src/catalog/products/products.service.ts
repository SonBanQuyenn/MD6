import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService, CacheStatus } from '../../cache/cache.service';
import {
  CACHE_TTL,
  CatalogCacheInvalidator,
  catalogKeys,
} from '../../cache/catalog-cache';
import { Paginated } from '../../common/dto/pagination-query.dto';
import { isPrismaError } from '../../common/utils/prisma-errors';
import { slugify } from '../../common/utils/slugify';
import { BrandsRepository } from '../brands/brands.repository';
import { CategoriesRepository } from '../categories/categories.repository';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductView, toProductView } from './product.mapper';
import { ProductsRepository } from './products.repository';

export interface Cached<T> {
  data: T;
  cache: CacheStatus;
}

/** Phần được cache của 1 trang danh sách: CHỈ id + tổng số (xem cache/catalog-cache.ts). */
interface CachedListPage {
  ids: string[];
  total: number;
}

const productCacheOptions = {
  ttlSeconds: CACHE_TTL.PRODUCT,
  nullTtlSeconds: CACHE_TTL.NULL,
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
    private readonly brands: BrandsRepository,
    private readonly cache: CacheService,
    private readonly invalidator: CatalogCacheInvalidator,
  ) {}

  async list(query: ListProductsQueryDto): Promise<Paginated<ProductView>> {
    return (await this.listWithCache(query)).data;
  }

  async getPublic(id: string): Promise<ProductView> {
    return (await this.getPublicWithCache(id)).data;
  }

  /** Danh sách công khai (chỉ SP đang bán), có cache (F04.1). */
  async listWithCache(
    query: ListProductsQueryDto,
  ): Promise<Cached<Paginated<ProductView>>> {
    const { page, limit, sort, ...filter } = query;
    if (
      filter.minPrice !== undefined &&
      filter.maxPrice !== undefined &&
      filter.minPrice > filter.maxPrice
    ) {
      throw new BadRequestException('minPrice không được lớn hơn maxPrice');
    }

    const loadPage = async (): Promise<CachedListPage> => {
      const { items, total } = await this.products.findMany(
        { ...filter, onlyActive: true },
        { skip: (page - 1) * limit, take: limit, sort },
      );
      // Đã đọc đủ chi tiết từ DB → ghi luôn vào cache chi tiết (làm "ấm" cache).
      await this.cache.setMany(
        items.map((p) => ({
          key: catalogKeys.product(p.id),
          value: toProductView(p),
        })),
        productCacheOptions,
      );
      return { ids: items.map((p) => p.id), total };
    };

    const version = await this.cache.getNumber(catalogKeys.version);
    let pageResult: CachedListPage;
    let status: CacheStatus;
    if (version === null) {
      // Redis lỗi → đọc thẳng DB
      pageResult = await loadPage();
      status = 'BYPASS';
    } else {
      const result = await this.cache.getOrLoad(
        catalogKeys.productList(version, { ...filter, page, limit, sort }),
        loadPage,
        { ttlSeconds: CACHE_TTL.PRODUCT_LIST },
      );
      pageResult = result.value!;
      status = result.status;
    }

    const { items, allCached } = await this.hydrate(pageResult.ids);
    return {
      data: {
        items,
        page,
        limit,
        total: pageResult.total,
        totalPages: Math.ceil(pageResult.total / limit),
      },
      cache: status === 'HIT' && !allCached ? 'MISS' : status,
    };
  }

  /** Chi tiết công khai, có cache. SP ngừng bán / không tồn tại → 404 (và cache "rỗng" 60s). */
  async getPublicWithCache(id: string): Promise<Cached<ProductView>> {
    const { value, status } = await this.cache.getOrLoad<ProductView>(
      catalogKeys.product(id),
      async () => {
        const product = await this.products.findById(id);
        return product && product.isActive ? toProductView(product) : null;
      },
      productCacheOptions,
    );
    if (!value || !value.isActive) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    return { data: value, cache: status };
  }

  async create(dto: CreateProductDto): Promise<ProductView> {
    await this.assertTaxonomyExists(dto.categoryId, dto.brandId);
    try {
      const product = await this.products.create({
        ...dto,
        // Thêm SKU vào slug → 2 sản phẩm cùng tên vẫn có slug khác nhau.
        slug: `${slugify(dto.name)}-${dto.sku.toLowerCase()}`,
      });
      await this.invalidator.invalidateLists();
      return toProductView(product);
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('SKU đã tồn tại');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductView> {
    const current = await this.products.findById(id);
    if (!current) throw new NotFoundException('Không tìm thấy sản phẩm');
    await this.assertTaxonomyExists(dto.categoryId, dto.brandId);

    const data: Prisma.ProductUncheckedUpdateInput = { ...dto };
    if (dto.name && dto.name !== current.name) {
      data.slug = `${slugify(dto.name)}-${current.sku.toLowerCase()}`;
    }
    if (dto.price !== undefined && dto.price !== current.price) {
      data.version = { increment: 1 };
    }
    const updated = await this.products.update(id, data);

    // Làm mới cache NGAY sau khi DB đã cập nhật → khách không thấy giá cũ (F04.2).
    await this.invalidator.invalidateProducts([id]);
    // Giá / danh mục / thương hiệu / trạng thái bán đổi → tập kết quả lọc có thể đổi.
    await this.invalidator.invalidateLists();
    return toProductView(updated);
  }

  /** "Xoá" = ngừng bán (soft delete). Không xoá hẳn vì đơn hàng cũ vẫn tham chiếu sản phẩm. */
  async deactivate(id: string): Promise<void> {
    const current = await this.products.findById(id);
    if (!current) throw new NotFoundException('Không tìm thấy sản phẩm');
    await this.products.update(id, {
      isActive: false,
      version: { increment: 1 },
    });
    await this.invalidator.invalidateProducts([id]);
    await this.invalidator.invalidateLists();
  }

  /**
   * Lấy chi tiết các sản phẩm theo thứ tự id: đọc cache trước (MGET),
   * thiếu cái nào thì đọc DB 1 lần cho tất cả cái thiếu rồi ghi lại cache.
   */
  private async hydrate(
    ids: string[],
  ): Promise<{ items: ProductView[]; allCached: boolean }> {
    const cached = await this.cache.getMany<ProductView>(
      ids.map(catalogKeys.product),
    );
    const byId = new Map<string, ProductView>();
    const missing: string[] = [];
    ids.forEach((id, i) => {
      const value = cached[i];
      if (value) byId.set(id, value);
      else if (value === undefined) missing.push(id);
    });

    if (missing.length > 0) {
      const loaded = (await this.products.findManyByIds(missing)).map(
        toProductView,
      );
      loaded.forEach((p) => byId.set(p.id, p));
      await this.cache.setMany(
        loaded.map((p) => ({ key: catalogKeys.product(p.id), value: p })),
        productCacheOptions,
      );
    }

    return {
      // Sản phẩm vừa bị ngừng bán giữa chừng → bỏ khỏi danh sách hiển thị.
      items: ids
        .map((id) => byId.get(id))
        .filter((p): p is ProductView => !!p && p.isActive),
      allCached: missing.length === 0,
    };
  }

  private async assertTaxonomyExists(
    categoryId?: string,
    brandId?: string,
  ): Promise<void> {
    if (categoryId && !(await this.categories.findById(categoryId))) {
      throw new BadRequestException('Danh mục không tồn tại');
    }
    if (brandId && !(await this.brands.findById(brandId))) {
      throw new BadRequestException('Thương hiệu không tồn tại');
    }
  }
}
