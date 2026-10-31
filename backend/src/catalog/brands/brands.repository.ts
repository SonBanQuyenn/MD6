import { Injectable } from '@nestjs/common';
import { Brand } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type BrandWithCount = Brand & { productCount: number };

@Injectable()
export class BrandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<BrandWithCount[]> {
    const rows = await this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { products: { where: { isActive: true } } } },
      },
    });
    return rows.map(({ _count, ...brand }) => ({
      ...brand,
      productCount: _count.products,
    }));
  }

  findById(id: string): Promise<Brand | null> {
    return this.prisma.brand.findUnique({ where: { id } });
  }

  create(data: { name: string; slug: string }): Promise<Brand> {
    return this.prisma.brand.create({ data });
  }

  update(id: string, data: { name?: string; slug?: string }): Promise<Brand> {
    return this.prisma.brand.update({ where: { id }, data });
  }

  delete(id: string): Promise<Brand> {
    return this.prisma.brand.delete({ where: { id } });
  }
}
