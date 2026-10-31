import { Injectable } from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type CategoryWithCount = Category & { productCount: number };

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<CategoryWithCount[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { products: { where: { isActive: true } } } },
      },
    });
    return rows.map(({ _count, ...category }) => ({
      ...category,
      productCount: _count.products,
    }));
  }

  findById(id: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  create(data: { name: string; slug: string }): Promise<Category> {
    return this.prisma.category.create({ data });
  }

  update(
    id: string,
    data: { name?: string; slug?: string },
  ): Promise<Category> {
    return this.prisma.category.update({ where: { id }, data });
  }

  delete(id: string): Promise<Category> {
    return this.prisma.category.delete({ where: { id } });
  }
}
