import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const cartInclude = {
  product: {
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      stock: true,
      isActive: true,
      imageUrl: true,
    },
  },
} satisfies Prisma.CartItemInclude;

export type CartItemWithProduct = Prisma.CartItemGetPayload<{
  include: typeof cartInclude;
}>;

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  findItems(userId: string): Promise<CartItemWithProduct[]> {
    return this.prisma.cartItem.findMany({
      where: { userId },
      include: cartInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  findItem(userId: string, productId: string) {
    return this.prisma.cartItem.findUnique({
      where: { userId_productId: { userId, productId } },
    });
  }

  findProduct(productId: string) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true, isActive: true },
    });
  }

  /** Thêm mới hoặc ghi đè số lượng (upsert theo cặp user + sản phẩm). */
  async setQuantity(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId, quantity },
      update: { quantity },
    });
  }

  async removeItem(userId: string, productId: string): Promise<number> {
    const { count } = await this.prisma.cartItem.deleteMany({
      where: { userId, productId },
    });
    return count;
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
  }
}
