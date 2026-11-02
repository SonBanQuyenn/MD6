import { Injectable, Logger } from '@nestjs/common';
import type { OrderView } from '../orders/order.mapper';
import { OrdersGateway } from './orders.gateway';

/**
 * Cầu nối giữa nghiệp vụ đơn hàng và kênh realtime. OrdersService chỉ biết "trạng thái đã đổi",
 * không cần biết Socket.IO — dễ test và đổi cơ chế sau này.
 */
@Injectable()
export class OrderEventsPublisher {
  private readonly logger = new Logger(OrderEventsPublisher.name);

  constructor(private readonly gateway: OrdersGateway) {}

  statusChanged(order: OrderView): void {
    const last = order.statusHistory?.at(-1);
    try {
      this.gateway.emitStatus({
        orderId: order.id,
        code: order.code,
        status: order.status,
        statusLabel: order.statusLabel,
        paymentStatus: order.paymentStatus,
        note: last?.note ?? null,
        at: (last?.at ?? order.updatedAt).toISOString(),
      });
    } catch (error) {
      // Lỗi realtime không được làm hỏng việc đổi trạng thái đã ghi DB thành công.
      this.logger.warn(`Không phát được sự kiện đơn ${order.id}: ${error}`);
    }
  }
}
