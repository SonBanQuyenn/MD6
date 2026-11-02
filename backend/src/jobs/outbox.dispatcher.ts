import { Injectable, Logger } from '@nestjs/common';
import { JobOutbox, OutboxEventType, PaymentMethod } from '@prisma/client';
import { JobsProducer } from './jobs.producer';
import { OutboxRepository } from './outbox.repository';

/** Đẩy lên hàng đợi tối đa bao lâu trước khi bỏ cuộc (để không làm chậm request của khách). */
const DISPATCH_TIMEOUT_MS = 2_000;

export interface DispatchResult {
  dispatched: number;
  failed: number;
}

/**
 * Chuyển sự kiện trong bảng job_outbox thành job trên BullMQ.
 *
 * Được gọi ở 2 nơi:
 *  1. Ngay sau khi đặt/huỷ đơn thành công (đường nhanh).
 *  2. Job "outbox-sweep" chạy mỗi phút trong worker (đường dự phòng khi bước 1 thất bại).
 *
 * KHÔNG BAO GIỜ ném lỗi ra ngoài: hàng đợi hỏng không được làm hỏng việc đặt đơn.
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly producer: JobsProducer,
  ) {}

  async dispatchForOrder(orderId: string): Promise<DispatchResult> {
    return this.dispatch(await this.safeFind({ orderId, limit: 10 }));
  }

  /** Quét các sự kiện bị sót (tạo trước `olderThanMs`), dùng cho job định kỳ. */
  async dispatchStale(
    olderThanMs = 30_000,
    limit = 100,
  ): Promise<DispatchResult> {
    return this.dispatch(
      await this.safeFind({
        createdBefore: new Date(Date.now() - olderThanMs),
        limit,
      }),
    );
  }

  private async dispatch(events: JobOutbox[]): Promise<DispatchResult> {
    const result: DispatchResult = { dispatched: 0, failed: 0 };
    for (const event of events) {
      try {
        await withTimeout(this.enqueue(event), DISPATCH_TIMEOUT_MS);
        await this.outbox.markDispatched(event.id);
        result.dispatched++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Chưa đẩy được sự kiện ${event.type} của đơn ${event.orderId}: ${message} — sẽ thử lại ở lần quét sau`,
        );
        await this.outbox.markFailed(event.id, message).catch(() => undefined);
        result.failed++;
      }
    }
    return result;
  }

  private enqueue(event: JobOutbox): Promise<void> {
    switch (event.type) {
      case OutboxEventType.ORDER_PLACED: {
        const { paymentMethod } = event.payload as {
          paymentMethod: PaymentMethod;
        };
        return this.producer.orderPlaced(event.orderId, paymentMethod);
      }
      case OutboxEventType.ORDER_CANCELLED:
        return this.producer.orderCancelled(event.orderId);
    }
  }

  private async safeFind(
    params: Parameters<OutboxRepository['findPending']>[0],
  ): Promise<JobOutbox[]> {
    try {
      return await this.outbox.findPending(params);
    } catch (error) {
      this.logger.error(`Không đọc được job_outbox: ${String(error)}`);
      return [];
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Quá ${ms}ms khi đẩy job lên hàng đợi`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
