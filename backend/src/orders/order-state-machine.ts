import { OrderStatus } from '@prisma/client';

/**
 * Máy trạng thái đơn hàng — chỉ những bước chuyển dưới đây là hợp lệ.
 *
 *   PENDING ──► CONFIRMED ──► PACKING ──► SHIPPING ──► DELIVERED
 *      │            │
 *      └────────────┴──► CANCELLED
 *
 * Đơn đã đóng gói / đang giao không được huỷ (hàng đã rời kệ).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PACKING, OrderStatus.CANCELLED],
  [OrderStatus.PACKING]: [OrderStatus.SHIPPING],
  [OrderStatus.SHIPPING]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: 'Chờ xác nhận',
  [OrderStatus.CONFIRMED]: 'Đã xác nhận',
  [OrderStatus.PACKING]: 'Đang đóng gói',
  [OrderStatus.SHIPPING]: 'Đang giao',
  [OrderStatus.DELIVERED]: 'Đã giao',
  [OrderStatus.CANCELLED]: 'Đã huỷ',
};
