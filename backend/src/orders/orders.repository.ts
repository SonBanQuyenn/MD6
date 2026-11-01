import { Injectable } from '@nestjs/common';
import {
  InventoryReason,
  OrderStatus,
  OutboxEventType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { isPrismaError } from '../common/utils/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderItemUnavailableError,
  OrderStatusConflictError,
  PromotionUnavailableError,
} from './order.errors';
import { OrderTotals } from './pricing';

const orderDetailInclude = {
  items: true,
  promotion: { select: { code: true } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

const orderListInclude = {
  items: true,
  promotion: { select: { code: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{
  include: typeof orderDetailInclude;
}>;
export type OrderSummary = Prisma.OrderGetPayload<{
  include: typeof orderListInclude;
}>;

export interface OrderLineInput {
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

export interface PlaceOrderInput {
  userId: string;
  code: string;
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  shippingAddress: Prisma.InputJsonValue;
  note?: string;
  lines: OrderLineInput[];
  totals: OrderTotals;
  promotion?: { id: string; perUserLimit: number };
}

export interface StatusChangeInput {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  actorId: string;
  note?: string;
  /** Huỷ đơn → cộng lại tồn kho */
  restock: boolean;
  /** Các field khác cập nhật cùng lúc (paymentStatus, paidAt, cancelledAt…) */
  extra?: Prisma.OrderUncheckedUpdateManyInput;
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ĐẶT ĐƠN — tất cả bước dưới đây nằm trong MỘT transaction:
   * lỗi ở bất kỳ bước nào → ROLLBACK, không có gì bị thay đổi.
   *
   * 1. (Nếu có mã KM) giữ khoá theo khách + mã, kiểm tra lượt của khách, trừ 1 lượt chung.
   * 2. Trừ kho từng sản phẩm bằng UPDATE có điều kiện `stock >= số lượng` (chống bán vượt).
   * 3. Tạo đơn + dòng đơn + lịch sử trạng thái + nhật ký kho; xoá giỏ hàng.
   */
  placeOrder(input: PlaceOrderInput): Promise<OrderDetail> {
    return this.prisma.$transaction(
      async (tx) => {
        if (input.promotion) {
          await this.claimPromotion(tx, input.userId, input.promotion);
        }

        // Luôn khoá các dòng sản phẩm theo CÙNG một thứ tự (theo id) → tránh deadlock
        // khi 2 đơn cùng chứa sản phẩm A và B nhưng thứ tự trong giỏ khác nhau.
        const lines = [...input.lines].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        );
        const stockAfter = new Map<string, number>();
        for (const line of lines) {
          stockAfter.set(line.productId, await this.takeStock(tx, line));
        }

        const order = await tx.order.create({
          data: {
            code: input.code,
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
            paymentMethod: input.paymentMethod,
            shippingAddress: input.shippingAddress,
            note: input.note,
            promotionId: input.promotion?.id,
            ...input.totals,
            items: {
              create: input.lines.map((line) => ({
                productId: line.productId,
                productName: line.productName,
                sku: line.sku,
                unitPrice: line.unitPrice,
                quantity: line.quantity,
              })),
            },
            statusHistory: {
              create: {
                toStatus: OrderStatus.PENDING,
                changedById: input.userId,
                note: 'Khách đặt đơn',
              },
            },
          },
          include: orderDetailInclude,
        });

        await tx.inventoryMovement.createMany({
          data: lines.map((line) => ({
            productId: line.productId,
            delta: -line.quantity,
            stockAfter: stockAfter.get(line.productId)!,
            reason: InventoryReason.ORDER,
            orderId: order.id,
            actorId: input.userId,
          })),
        });

        await tx.cartItem.deleteMany({
          where: {
            userId: input.userId,
            productId: { in: lines.map((l) => l.productId) },
          },
        });

        // Transactional outbox: ghi sự kiện CÙNG transaction với đơn hàng.
        // Đơn commit thành công ⇔ sự kiện chắc chắn tồn tại → email/hoá đơn không bao giờ bị mất,
        // kể cả khi Redis chết ngay lúc này (job quét outbox sẽ đẩy lại).
        await tx.jobOutbox.create({
          data: {
            type: OutboxEventType.ORDER_PLACED,
            orderId: order.id,
            payload: { paymentMethod: input.paymentMethod },
          },
        });
        return order;
      },
      { timeout: 10_000 },
    );
  }

  /** Đổi trạng thái đơn (có thể kèm hoàn kho) trong 1 transaction. */
  changeStatus(input: StatusChangeInput): Promise<OrderDetail> {
    return this.prisma.$transaction(async (tx) => {
      // Điều kiện `status: from` = khoá lạc quan: nếu người khác vừa đổi trạng thái
      // (vd: khách huỷ đúng lúc kho xác nhận) → 0 dòng → báo xung đột, không ghi đè.
      const { count } = await tx.order.updateMany({
        where: { id: input.orderId, status: input.from },
        data: { status: input.to, ...input.extra },
      });
      if (count === 0) throw new OrderStatusConflictError();

      await tx.orderStatusHistory.create({
        data: {
          orderId: input.orderId,
          fromStatus: input.from,
          toStatus: input.to,
          changedById: input.actorId,
          note: input.note,
        },
      });

      if (input.to === OrderStatus.CANCELLED) {
        await tx.jobOutbox.create({
          data: {
            type: OutboxEventType.ORDER_CANCELLED,
            orderId: input.orderId,
            payload: {},
          },
        });
      }

      if (input.restock) {
        const items = await tx.orderItem.findMany({
          where: { orderId: input.orderId },
          orderBy: { productId: 'asc' },
        });
        for (const item of items) {
          const product = await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { increment: item.quantity },
              version: { increment: 1 },
            },
          });
          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              delta: item.quantity,
              stockAfter: product.stock,
              reason: InventoryReason.CANCEL,
              orderId: input.orderId,
              actorId: input.actorId,
            },
          });
        }
      }

      return tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        include: orderDetailInclude,
      });
    });
  }

  findInvoice(orderId: string) {
    return this.prisma.invoice.findUnique({ where: { orderId } });
  }

  findById(id: string): Promise<OrderDetail | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: orderDetailInclude,
    });
  }

  findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<OrderDetail | null> {
    return this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: orderDetailInclude,
    });
  }

  async findMany(params: {
    userId?: string;
    status?: OrderStatus;
    skip: number;
    take: number;
  }): Promise<{ items: OrderSummary[]; total: number }> {
    const where: Prisma.OrderWhereInput = {
      userId: params.userId,
      status: params.status,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderListInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  private async claimPromotion(
    tx: Prisma.TransactionClient,
    userId: string,
    promotion: { id: string; perUserLimit: number },
  ): Promise<void> {
    // Khoá theo cặp (khách, mã KM) tới hết transaction: 2 đơn đồng thời của CÙNG một khách
    // dùng cùng mã sẽ chạy lần lượt → không lách được giới hạn lượt/khách.
    const lockKey = `${userId}:${promotion.id}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text`;

    const usedByUser = await tx.order.count({
      where: {
        userId,
        promotionId: promotion.id,
        status: { not: OrderStatus.CANCELLED },
      },
    });
    if (usedByUser >= promotion.perUserLimit) {
      throw new PromotionUnavailableError('USER_LIMIT');
    }

    const now = new Date();
    const { count } = await tx.promotion.updateMany({
      where: {
        id: promotion.id,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        // So sánh 2 cột trong cùng dòng: used_count < max_uses
        usedCount: { lt: tx.promotion.fields.maxUses },
      },
      data: { usedCount: { increment: 1 } },
    });
    if (count === 0) {
      throw new PromotionUnavailableError('SOLD_OUT_OR_EXPIRED');
    }
  }

  /** Trừ kho nguyên tử. Trả về tồn kho sau khi trừ, hoặc ném lỗi nêu rõ lý do. */
  private async takeStock(
    tx: Prisma.TransactionClient,
    line: OrderLineInput,
  ): Promise<number> {
    try {
      const product = await tx.product.update({
        where: {
          id: line.productId,
          isActive: true,
          // Giá phải đúng giá khách đã thấy → admin đổi giá giữa chừng thì không bán sai giá.
          price: line.unitPrice,
          stock: { gte: line.quantity },
        },
        data: {
          stock: { decrement: line.quantity },
          version: { increment: 1 },
        },
      });
      return product.stock;
    } catch (error) {
      if (!isPrismaError(error, 'P2025')) throw error;
      const current = await tx.product.findUnique({
        where: { id: line.productId },
      });
      const reason = !current
        ? 'NOT_FOUND'
        : !current.isActive
          ? 'INACTIVE'
          : current.price !== line.unitPrice
            ? 'PRICE_CHANGED'
            : 'OUT_OF_STOCK';
      throw new OrderItemUnavailableError(
        line.productId,
        line.productName,
        reason,
        current?.stock ?? 0,
      );
    }
  }
}
