import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClassifiedBy } from '@prisma/client';
import { classifyByKeywords } from './ai/keyword-classifier';
import { Classification, LLM_PROVIDER, LlmProvider } from './ai/llm.types';
import { TicketsRepository } from './tickets.repository';

export type ClassifyResult =
  | { status: 'classified'; by: ClassifiedBy; classification: Classification }
  | { status: 'skipped'; reason: string };

/**
 * Phân loại ticket tự động (F01.1). Chạy trong WORKER (hàng đợi `support`) để khách tạo ticket
 * không phải chờ AI. AI lỗi → dùng bộ từ khoá dự phòng, ghi `classifiedBy = FALLBACK`.
 * Đang chạy MOCK → cũng ghi FALLBACK (không gắn nhãn "AI" cho thứ không phải AI).
 */
@Injectable()
export class TicketClassifierService {
  private readonly logger = new Logger(TicketClassifierService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly tickets: TicketsRepository,
  ) {}

  async classify(ticketId: string): Promise<ClassifyResult> {
    const ticket = await this.tickets.findTextForClassification(ticketId);
    if (!ticket) return { status: 'skipped', reason: 'ticket not found' };
    if (ticket.classifiedBy === ClassifiedBy.HUMAN) {
      return { status: 'skipped', reason: 'đã được nhân viên phân loại' };
    }
    const text = `${ticket.subject}\n${ticket.messages[0]?.content ?? ''}`;

    let classification: Classification;
    let by: ClassifiedBy;
    if (this.llm.isMock) {
      classification = classifyByKeywords(text);
      by = ClassifiedBy.FALLBACK;
    } else {
      try {
        classification = await this.llm.classify(text);
        by = ClassifiedBy.AI;
      } catch (error) {
        this.logger.warn(
          `AI phân loại lỗi, dùng từ khoá dự phòng cho ticket ${ticketId}: ${String(error)}`,
        );
        classification = classifyByKeywords(text);
        by = ClassifiedBy.FALLBACK;
      }
    }

    const saved = await this.tickets.saveClassification(ticketId, {
      category: classification.category,
      confidence: classification.confidence,
      classifiedBy: by,
    });
    if (!saved) return { status: 'skipped', reason: 'nhân viên vừa phân loại' };
    return { status: 'classified', by, classification };
  }
}
