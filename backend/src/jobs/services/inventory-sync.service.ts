import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { isPrismaError } from '../../common/utils/prisma-errors';
import { JobDataRepository } from '../job-data.repository';
import { InventorySyncJobData, jobIds } from '../queues';
import { PartnerInventoryClient } from './partner-inventory.client';

export type SyncResult = 'synced' | 'already-synced';

/**
 * Báo tồn kho mới cho đối tác sau khi đơn được đặt / huỷ.
 * Gửi MỨC TỒN KHO HIỆN TẠI (không gửi "trừ 2") → gửi lại nhiều lần vẫn cho kết quả đúng,
 * và các job đến không theo thứ tự cũng không làm sai số liệu.
 */
@Injectable()
export class InventorySyncService {
  constructor(
    private readonly data: JobDataRepository,
    private readonly partner: PartnerInventoryClient,
  ) {}

  async sync(job: InventorySyncJobData): Promise<SyncResult> {
    const dedupeKey = jobIds.inventorySync(job.orderId, job.event);
    if (await this.data.findSyncLog(dedupeKey)) return 'already-synced';

    const order = await this.data.findOrder(job.orderId);
    if (!order)
      throw new UnrecoverableError(`Không tìm thấy đơn ${job.orderId}`);

    const levels = (
      await this.data.productStocks(order.items.map((i) => i.productId))
    ).map((p) => ({ sku: p.sku, stock: p.stock }));

    // Lỗi mạng / đối tác chết → ném lỗi → BullMQ retry theo backoff.
    const { partnerRef } = await this.partner.pushStockLevels(
      dedupeKey,
      levels,
    );

    try {
      await this.data.createSyncLog({
        dedupeKey,
        orderId: job.orderId,
        payload: { event: job.event, levels },
        partnerRef,
      });
    } catch (error) {
      if (!isPrismaError(error, 'P2002')) throw error;
      return 'already-synced';
    }
    return 'synced';
  }
}
