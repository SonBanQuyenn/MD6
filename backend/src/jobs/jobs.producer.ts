import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  InventorySyncJobData,
  jobIds,
  JOBS,
  OrderJobData,
  QUEUE_JOB_OPTIONS,
  QUEUES,
  TicketJobData,
  VerificationCodeJobData,
} from './queues';

/** Đẩy job vào hàng đợi. Chỉ THÊM job — việc xử lý nằm ở tiến trình worker. */
@Injectable()
export class JobsProducer {
  private readonly paymentReminderDelay: number;

  constructor(
    @InjectQueue(QUEUES.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUES.INVOICE) private readonly invoiceQueue: Queue,
    @InjectQueue(QUEUES.INVENTORY_SYNC) private readonly syncQueue: Queue,
    @InjectQueue(QUEUES.SUPPORT) private readonly supportQueue: Queue,
    config: ConfigService,
  ) {
    this.paymentReminderDelay = config.get<number>(
      'PAYMENT_REMINDER_DELAY_MS',
      30 * 60 * 1000,
    );
  }

  /** Đơn vừa đặt: email xác nhận, xuất hoá đơn, đồng bộ kho, (online) hẹn nhắc thanh toán. */
  async orderPlaced(
    orderId: string,
    paymentMethod: PaymentMethod,
  ): Promise<void> {
    const data: OrderJobData = { orderId };
    const jobs: Promise<unknown>[] = [
      this.emailQueue.add(JOBS.ORDER_CONFIRMATION, data, {
        ...QUEUE_JOB_OPTIONS[QUEUES.EMAIL],
        jobId: jobIds.orderConfirmation(orderId),
      }),
      this.invoiceQueue.add(JOBS.GENERATE_INVOICE, data, {
        ...QUEUE_JOB_OPTIONS[QUEUES.INVOICE],
        jobId: jobIds.invoice(orderId),
      }),
      this.addInventorySync(orderId, 'placed'),
    ];
    // COD trả tiền khi nhận hàng → không cần nhắc thanh toán.
    if (paymentMethod === PaymentMethod.MOCK_ONLINE) {
      jobs.push(
        this.emailQueue.add(JOBS.PAYMENT_REMINDER, data, {
          ...QUEUE_JOB_OPTIONS[QUEUES.EMAIL],
          jobId: jobIds.paymentReminder(orderId),
          delay: this.paymentReminderDelay, // job "ngủ" 30 phút rồi mới chạy
        }),
      );
    }
    await Promise.all(jobs);
  }

  /**
   * Email mã xác thực. Khác các job khác: dữ liệu chứa mã gốc → xoá job ngay khi xong,
   * job lỗi chỉ giữ 10 phút (bằng thời hạn của mã) rồi xoá.
   */
  async verificationCode(data: VerificationCodeJobData): Promise<void> {
    await this.emailQueue.add(JOBS.VERIFICATION_CODE, data, {
      ...QUEUE_JOB_OPTIONS[QUEUES.EMAIL],
      jobId: jobIds.verificationCode(data.codeId),
      removeOnComplete: true,
      removeOnFail: { age: 10 * 60 },
    });
  }

  /** Ticket mới → phân loại ở worker (F01.1). */
  async classifyTicket(ticketId: string): Promise<void> {
    const data: TicketJobData = { ticketId };
    await this.supportQueue.add(JOBS.CLASSIFY_TICKET, data, {
      ...QUEUE_JOB_OPTIONS[QUEUES.SUPPORT],
      jobId: jobIds.classifyTicket(ticketId),
    });
  }

  /** Đơn bị huỷ: hàng đã được cộng lại kho → báo cho đối tác. */
  async orderCancelled(orderId: string): Promise<void> {
    await this.addInventorySync(orderId, 'cancelled');
  }

  private addInventorySync(
    orderId: string,
    event: InventorySyncJobData['event'],
  ) {
    const data: InventorySyncJobData = { orderId, event };
    return this.syncQueue.add(JOBS.SYNC_INVENTORY, data, {
      ...QUEUE_JOB_OPTIONS[QUEUES.INVENTORY_SYNC],
      jobId: jobIds.inventorySync(orderId, event),
    });
  }
}
