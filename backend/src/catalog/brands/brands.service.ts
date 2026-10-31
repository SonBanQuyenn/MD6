import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Brand } from '@prisma/client';
import { isPrismaError } from '../../common/utils/prisma-errors';
import { slugify } from '../../common/utils/slugify';
import { CreateTaxonomyDto, UpdateTaxonomyDto } from '../dto/taxonomy.dto';
import { BrandsRepository, BrandWithCount } from './brands.repository';

@Injectable()
export class BrandsService {
  constructor(private readonly brands: BrandsRepository) {}

  list(): Promise<BrandWithCount[]> {
    return this.brands.findAll();
  }

  async create(dto: CreateTaxonomyDto): Promise<Brand> {
    try {
      return await this.brands.create({
        name: dto.name,
        slug: dto.slug ?? slugify(dto.name),
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Slug thương hiệu đã tồn tại');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTaxonomyDto): Promise<Brand> {
    try {
      return await this.brands.update(id, dto);
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
