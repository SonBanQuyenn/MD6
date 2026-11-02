import { Injectable } from '@nestjs/common';
import { InventoryMovement, InventoryReason, Product } from '@prisma/client';
import { isPrismaError } from '../common/utils/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

export type AdjustResult =
  | { ok: true; product: Product; movement: InventoryMovement }
  | { ok: false; reason: 'NOT_FOUND' | 'INSUFFICIENT'; available: number };

@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cộng/trừ tồn kho NGUYÊN TỬ + ghi nhật ký trong cùng 1 transaction.
   * Khi trừ (delta < 0): điều kiện `stock >= -delta` nằm ngay trong câu UPDATE,
   * nên 2 nhân viên trừ cùng lúc cũng không thể làm tồn kho âm.
   */
  adjust(input: {
    productId: string;
    delta: number;
    reason: InventoryReason;
    actorId: string;
    note?: string;
  }): Promise<AdjustResult> {
    return this.prisma.$transaction(async (tx) => {
      let product: Product;
      try {
        product = await tx.product.update({
          where: {
            id: input.productId,
            ...(input.delta < 0 ? { stock: { gte: -input.delta } } : {}),
          },
          data: {
            stock: { increment: input.delta },
            version: { increment: 1 },
          },
        });
      } catch (error) {
        if (!isPrismaError(error, 'P2025')) throw error;
        const current = await tx.product.findUnique({
          where: { id: input.productId },
        });
        return current
          ? { ok: false, reason: 'INSUFFICIENT', available: current.stock }
          : { ok: false, reason: 'NOT_FOUND', available: 0 };
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          productId: input.productId,
          delta: input.delta,
          stockAfter: product.stock,
          reason: input.reason,
          actorId: input.actorId,
          note: input.note,
        },
      });
      return { ok: true, product, movement };
    });
  }

  async findMovements(
    productId: string,
    page: { skip: number; take: number },
  ): Promise<{ items: InventoryMovement[]; total: number }> {
    const where = { productId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return { items, total };
  }

  async findLowStock(
    threshold: number,
    page: { skip: number; take: number },
  ): Promise<{ items: Product[]; total: number }> {
    const where = { isActive: true, stock: { lte: threshold } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ stock: 'asc' }, { name: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  productExists(id: string): Promise<boolean> {
    return this.prisma.product
      .count({ where: { id } })
      .then((count) => count > 0);
  }
}
