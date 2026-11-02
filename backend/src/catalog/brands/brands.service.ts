import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Brand } from '@prisma/client';
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
import { BrandsRepository, BrandWithCount } from './brands.repository';

@Injectable()
export class BrandsService {
  constructor(
    private readonly brands: BrandsRepository,
    private readonly products: ProductsRepository,
    private readonly cache: CacheService,
    private readonly invalidator: CatalogCacheInvalidator,
  ) {}

  async list(): Promise<BrandWithCount[]> {
    const version = await this.cache.getNumber(catalogKeys.version);
    if (version === null) return this.brands.findAll();
    const { value } = await this.cache.getOrLoad(
      catalogKeys.brands(version),
      () => this.brands.findAll(),
      { ttlSeconds: CACHE_TTL.TAXONOMY },
    );
    return value ?? [];
  }

  async create(dto: CreateTaxonomyDto): Promise<Brand> {
    try {
      const created = await this.brands.create({
        name: dto.name,
        slug: dto.slug ?? slugify(dto.name),
      });
      await this.invalidator.invalidateLists();
      return created;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Slug thương hiệu đã tồn tại');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTaxonomyDto): Promise<Brand> {
    try {
      const updated = await this.brands.update(id, dto);
      await this.invalidator.invalidateProducts(
        await this.products.findIdsByTaxonomy({ brandId: id }),
      );
      await this.invalidator.invalidateLists();
      return updated;
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Không tìm thấy thương hiệu');
      }
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Slug thương hiệu đã tồn tại');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.brands.delete(id);
      await this.invalidator.invalidateLists();
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Không tìm thấy thương hiệu');
      }
      if (isPrismaError(error, 'P2003')) {
        throw new ConflictException('Thương hiệu vẫn còn sản phẩm');
      }
      throw error;
    }
  }
}
