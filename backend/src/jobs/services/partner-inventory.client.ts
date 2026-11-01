import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface StockLevel {
  sku: string;
  stock: number;
}

/**
 * ⚠️ GIẢ LẬP API đối tác kho (SRS không chỉ định đối tác cụ thể — xem requirements.md A2).
 *
 * Mô phỏng một API bên ngoài thật: có độ trễ mạng, có thể lỗi ngẫu nhiên theo
 * PARTNER_SYNC_FAILURE_RATE, và — như mọi API thanh toán/kho tử tế — nhận
 * Idempotency-Key: gọi lại cùng key trả về cùng kết quả, không ghi nhận 2 lần.
 * Khi có đối tác thật, chỉ cần thay class này bằng HTTP client thật.
 */
@Injectable()
export class PartnerInventoryClient {
  private readonly logger = new Logger(PartnerInventoryClient.name);
  private readonly failureRate: number;
  /** Bộ nhớ chống trùng phía "đối tác" */
  private readonly seen = new Map<string, string>();

  constructor(config: ConfigService) {
    this.failureRate = config.get<number>('PARTNER_SYNC_FAILURE_RATE', 0);
  }

  async pushStockLevels(
    idempotencyKey: string,
    levels: StockLevel[],
  ): Promise<{ partnerRef: string }> {
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));

    if (Math.random() < this.failureRate) {
      throw new Error('Đối tác kho không phản hồi (lỗi giả lập 503)');
    }
    const existing = this.seen.get(idempotencyKey);
    if (existing) return { partnerRef: existing };

    const partnerRef = `PARTNER-${randomUUID()}`;
    this.seen.set(idempotencyKey, partnerRef);
    this.logger.log(
      `[GIẢ LẬP] Đối tác nhận ${levels.length} mức tồn kho (${idempotencyKey})`,
    );
    return { partnerRef };
  }
}
