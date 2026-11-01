/**
 * Lỗi nghiệp vụ do tầng Repository ném ra BÊN TRONG transaction.
 * Ném lỗi → Prisma ROLLBACK toàn bộ transaction (không trừ kho, không tạo đơn).
 * Tầng Service bắt các lỗi này và đổi thành mã HTTP + thông báo tiếng Việt.
 */

export type UnavailableReason =
  'NOT_FOUND' | 'INACTIVE' | 'PRICE_CHANGED' | 'OUT_OF_STOCK';

export class OrderItemUnavailableError extends Error {
  constructor(
    readonly productId: string,
    readonly productName: string,
    readonly reason: UnavailableReason,
    readonly available: number,
  ) {
    super(`Product ${productId} unavailable: ${reason}`);
  }
}

export type PromotionUnavailableReason = 'SOLD_OUT_OR_EXPIRED' | 'USER_LIMIT';

export class PromotionUnavailableError extends Error {
  constructor(readonly reason: PromotionUnavailableReason) {
    super(`Promotion unavailable: ${reason}`);
  }
}

/** Trạng thái đơn đã bị người khác đổi trong lúc mình đang xử lý. */
export class OrderStatusConflictError extends Error {
  constructor() {
    super('Order status changed concurrently');
  }
}
