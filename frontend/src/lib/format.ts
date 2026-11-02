import type { OrderStatus, TicketStatus } from '../api/types';

export const formatVnd = (amount: number | string) =>
  `${Number(amount).toLocaleString('vi-VN')}₫`;

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  PENDING: 'yellow',
  CONFIRMED: 'blue',
  PACKING: 'indigo',
  SHIPPING: 'cyan',
  DELIVERED: 'green',
  CANCELLED: 'gray',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PACKING: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã huỷ',
};

/** Phải khớp backend/src/orders/order-state-machine.ts — chỉ để hiển thị nút; backend vẫn kiểm tra lại. */
export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKING', 'CANCELLED'],
  PACKING: ['SHIPPING'],
  SHIPPING: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const ORDER_FLOW: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PACKING',
  'SHIPPING',
  'DELIVERED',
];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Mới',
  IN_PROGRESS: 'Đang xử lý',
  RESOLVED: 'Đã giải quyết',
  CLOSED: 'Đã đóng',
};

export const TICKET_STATUS_COLOR: Record<TicketStatus, string> = {
  OPEN: 'orange',
  IN_PROGRESS: 'blue',
  RESOLVED: 'green',
  CLOSED: 'gray',
};

export const CATEGORY_OPTIONS = [
  { value: 'ORDER_STATUS', label: 'Trạng thái đơn hàng' },
  { value: 'SHIPPING', label: 'Giao hàng' },
  { value: 'PAYMENT', label: 'Thanh toán' },
  { value: 'RETURN_REFUND', label: 'Đổi trả / hoàn tiền' },
  { value: 'PRODUCT_INQUIRY', label: 'Hỏi về sản phẩm' },
  { value: 'ACCOUNT', label: 'Tài khoản' },
  { value: 'COMPLAINT', label: 'Khiếu nại' },
  { value: 'OTHER', label: 'Khác' },
];

export const ROLE_LABEL = {
  CUSTOMER: 'Khách hàng',
  SUPPORT_AGENT: 'Nhân viên CSKH',
  WAREHOUSE_STAFF: 'Nhân viên kho',
  ADMIN: 'Quản trị viên',
} as const;
