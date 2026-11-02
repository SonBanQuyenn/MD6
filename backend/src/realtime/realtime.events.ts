import { OrderStatus } from '@prisma/client';

/** Tên sự kiện Socket.IO — dùng chung cho backend và frontend (frontend chép lại hằng số này). */
export const WS_EVENTS = {
  SUBSCRIBE: 'order:subscribe',
  UNSUBSCRIBE: 'order:unsubscribe',
  STATUS: 'order:status',
} as const;

/** Mỗi đơn hàng một phòng riêng — chỉ người được phép mới được join (F02.2). */
export const orderRoom = (orderId: string) => `order:${orderId}`;

export interface OrderStatusEvent {
  orderId: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: string;
  note: string | null;
  at: string;
}

export type SubscribeAck =
  | { ok: true; orderId: string; status: OrderStatus }
  | { ok: false; error: 'INVALID' | 'FORBIDDEN' };
