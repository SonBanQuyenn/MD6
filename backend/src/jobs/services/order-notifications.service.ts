import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import { EmailService } from '../../mail/email.service';
import {
  orderConfirmationEmail,
  paymentReminderEmail,
} from '../../mail/templates';
import { JobDataRepository, OrderForJobs } from '../job-data.repository';
import { jobIds, JOBS } from '../queues';

export type NotificationResult = 'sent' | 'already-sent' | 'skipped';

@Injectable()
export class OrderNotificationsService {
  constructor(
    private readonly data: JobDataRepository,
    private readonly email: EmailService,
  ) {}

  async sendOrderConfirmation(orderId: string): Promise<NotificationResult> {
    const order = await this.loadOrder(orderId);
    const { subject, html } = orderConfirmationEmail(toEmailData(order));
    return this.email.sendOnce({
      dedupeKey: jobIds.orderConfirmation(orderId),
      type: JOBS.ORDER_CONFIRMATION,
      orderId,
      to: order.user.email,
      subject,
      html,
    });
  }

  /**
   * Chạy 30 phút sau khi đặt đơn. Kiểm tra LẠI trạng thái lúc chạy:
   * khách đã thanh toán hoặc đơn đã huỷ → không nhắc nữa.
   */
  async sendPaymentReminder(orderId: string): Promise<NotificationResult> {
    const order = await this.loadOrder(orderId);
    if (
      order.paymentStatus !== PaymentStatus.UNPAID ||
      order.status !== OrderStatus.PENDING
    ) {
      return 'skipped';
    }
    const { subject, html } = paymentReminderEmail(toEmailData(order));
    return this.email.sendOnce({
      dedupeKey: jobIds.paymentReminder(orderId),
      type: JOBS.PAYMENT_REMINDER,
      orderId,
      to: order.user.email,
      subject,
      html,
    });
  }

  private async loadOrder(orderId: string): Promise<OrderForJobs> {
    const order = await this.data.findOrder(orderId);
    // Không tìm thấy đơn → thử lại cũng vô ích → báo BullMQ dừng ngay (không retry).
    if (!order) throw new UnrecoverableError(`Không tìm thấy đơn ${orderId}`);
    return order;
  }
}

function toEmailData(order: OrderForJobs) {
  return {
    code: order.code,
    customerName: order.user.fullName,
    total: order.total,
    items: order.items,
  };
}
