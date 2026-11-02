import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductSort } from './dto/list-products-query.dto';

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

export interface ProductFilter {
  categoryId?: string;
  brandId?: string;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  onlyActive: boolean;
}

const ORDER_BY: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> =
  {
    // Luôn thêm `id` làm tiêu chí phụ → thứ tự ổn định, phân trang không lặp/sót sản phẩm.
    [ProductSort.NEWEST]: [{ createdAt: 'desc' }, { id: 'asc' }],
    [ProductSort.PRICE_ASC]: [{ price: 'asc' }, { id: 'asc' }],
    [ProductSort.PRICE_DESC]: [{ price: 'desc' }, { id: 'asc' }],
    [ProductSort.NAME_ASC]: [{ name: 'asc' }, { id: 'asc' }],
  };

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    filter: ProductFilter,
    page: { skip: number; take: number; sort: ProductSort },
  ): Promise<{ items: ProductWithRelations[]; total: number }> {
    const where = buildWhere(filter);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: ORDER_BY[page.sort],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  /** Đọc nhiều sản phẩm theo id (dùng khi cache danh sách trúng nhưng thiếu chi tiết). */
  findManyByIds(ids: string[]): Promise<ProductWithRelations[]> {
    return this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: productInclude,
    });
  }

  findIdsByTaxonomy(where: {
    categoryId?: string;
    brandId?: string;
  }): Promise<string[]> {
    return this.prisma.product
      .findMany({ where, select: { id: true } })
      .then((rows) => rows.map((r) => r.id));
  }

  findById(id: string): Promise<ProductWithRelations | null> {
    return this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
  }

  create(
    data: Prisma.ProductUncheckedCreateInput,
  ): Promise<ProductWithRelations> {
    return this.prisma.product.create({ data, include: productInclude });
  }

  update(
    id: string,
    data: Prisma.ProductUncheckedUpdateInput,
  ): Promise<ProductWithRelations> {
    return this.prisma.product.update({
      where: { id },
      data,
      include: productInclude,
    });
  }
}

/** Chuyển bộ lọc thành điều kiện WHERE của Prisma (export để unit test). */
export function buildWhere(filter: ProductFilter): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  if (filter.onlyActive) where.isActive = true;
  if (filter.categoryId) where.categoryId = filter.categoryId;
  if (filter.brandId) where.brandId = filter.brandId;
  if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
    where.price = { gte: filter.minPrice, lte: filter.maxPrice };
  }
  if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
  return where;
}
