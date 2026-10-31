import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Paginated } from '../../common/dto/pagination-query.dto';
import { isPrismaError } from '../../common/utils/prisma-errors';
import { slugify } from '../../common/utils/slugify';
import { BrandsRepository } from '../brands/brands.repository';
import { CategoriesRepository } from '../categories/categories.repository';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductView, toProductView } from './product.mapper';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
    private readonly brands: BrandsRepository,
  ) {}

  /** Danh sách công khai: chỉ sản phẩm đang bán. */
  async list(query: ListProductsQueryDto): Promise<Paginated<ProductView>> {
    const { page, limit, sort, ...filter } = query;
    if (
      filter.minPrice !== undefined &&
      filter.maxPrice !== undefined &&
      filter.minPrice > filter.maxPrice
    ) {
      throw new BadRequestException('minPrice không được lớn hơn maxPrice');
    }

    const { items, total } = await this.products.findMany(
      { ...filter, onlyActive: true },
      { skip: (page - 1) * limit, take: limit, sort },
    );
    return {
      items: items.map(toProductView),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Chi tiết công khai: sản phẩm ngừng bán coi như không tồn tại. */
  async getPublic(id: string): Promise<ProductView> {
    const product = await this.products.findById(id);
    if (!product || !product.isActive) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    return toProductView(product);
  }

  async create(dto: CreateProductDto): Promise<ProductView> {
    await this.assertTaxonomyExists(dto.categoryId, dto.brandId);
    try {
      const product = await this.products.create({
        ...dto,
        // Thêm SKU vào slug → 2 sản phẩm cùng tên vẫn có slug khác nhau.
        slug: `${slugify(dto.name)}-${dto.sku.toLowerCase()}`,
      });
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
    // Giá đổi → tăng version. Phase 7 dùng version để làm mới cache ngay lập tức.
    if (dto.price !== undefined && dto.price !== current.price) {
      data.version = { increment: 1 };
    }
    return toProductView(await this.products.update(id, data));
  }

  /**
   * "Xoá" = ngừng bán (soft delete). Không xoá hẳn vì đơn hàng cũ vẫn tham chiếu sản phẩm.
   */
  async deactivate(id: string): Promise<void> {
    const current = await this.products.findById(id);
    if (!current) throw new NotFoundException('Không tìm thấy sản phẩm');
    await this.products.update(id, {
      isActive: false,
      version: { increment: 1 },
    });
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
