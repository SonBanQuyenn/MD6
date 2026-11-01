import { ORDER_STATUS_LABELS } from './order-state-machine';
import { OrderDetail, OrderSummary } from './orders.repository';

export function toOrderView(order: OrderSummary | OrderDetail) {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    promotionCode: order.promotion?.code ?? null,
    shippingAddress: order.shippingAddress,
    note: order.note,
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.unitPrice * item.quantity,
    })),
    ...('statusHistory' in order
      ? {
          statusHistory: order.statusHistory.map((h) => ({
            fromStatus: h.fromStatus,
            toStatus: h.toStatus,
            note: h.note,
            at: h.createdAt,
          })),
        }
      : {}),
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export type OrderView = ReturnType<typeof toOrderView>;
