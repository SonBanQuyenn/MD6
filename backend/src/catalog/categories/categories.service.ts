import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import { CacheService } from '../../cache/cache.service';
import {
  CACHE_TTL,
  CatalogCacheInvalidator,
  catalogKeys,
} from '../../cache/catalog-cache';
import { isPrismaError } from '../../common/utils/prisma-errors';
import { slugify } from '../../common/utils/slugify';
import { CreateTaxonomyDto, UpdateTaxonomyDto } from '../dto/taxonomy.dto';
import { ProductsRepository } from '../products/products.repository';
import {
  CategoriesRepository,
  CategoryWithCount,
} from './categories.repository';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categories: CategoriesRepository,
    private readonly products: ProductsRepository,
    private readonly cache: CacheService,
    private readonly invalidator: CatalogCacheInvalidator,
  ) {}

  /** Danh sách danh mục (kèm số SP đang bán) — cache theo catalog:version. */
  async list(): Promise<CategoryWithCount[]> {
    const version = await this.cache.getNumber(catalogKeys.version);
    if (version === null) return this.categories.findAll();
    const { value } = await this.cache.getOrLoad(
      catalogKeys.categories(version),
      () => this.categories.findAll(),
      { ttlSeconds: CACHE_TTL.TAXONOMY },
    );
    return value ?? [];
  }

  async create(dto: CreateTaxonomyDto): Promise<Category> {
    try {
      const created = await this.categories.create({
        name: dto.name,
        slug: dto.slug ?? slugify(dto.name),
      });
      await this.invalidator.invalidateLists();
      return created;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Slug danh mục đã tồn tại');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTaxonomyDto): Promise<Category> {
    try {
      const updated = await this.categories.update(id, dto);
      // Tên danh mục nằm trong cache chi tiết của từng sản phẩm → làm mới các sản phẩm đó.
      await this.invalidator.invalidateProducts(
        await this.products.findIdsByTaxonomy({ categoryId: id }),
      );
      await this.invalidator.invalidateLists();
      return updated;
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Không tìm thấy danh mục');
      }
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Slug danh mục đã tồn tại');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.categories.delete(id);
      await this.invalidator.invalidateLists();
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Không tìm thấy danh mục');
      }
      // Khoá ngoại onDelete: Restrict → không xoá được danh mục còn sản phẩm.
      if (isPrismaError(error, 'P2003')) {
        throw new ConflictException(
          'Danh mục vẫn còn sản phẩm, hãy chuyển sản phẩm sang danh mục khác trước',
        );
      }
      throw error;
    }
  }
}
