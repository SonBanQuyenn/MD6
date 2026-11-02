import { Injectable } from '@nestjs/common';
import {
  ClassifiedBy,
  MessageAuthor,
  PendingActionStatus,
  Prisma,
  TicketCategory,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ticketDetailInclude = {
  customer: { select: { id: true, email: true, fullName: true } },
  assignedAgent: { select: { id: true, fullName: true } },
  order: { select: { id: true, code: true, status: true } },
  messages: { orderBy: { createdAt: 'asc' } },
  toolCalls: { orderBy: { createdAt: 'asc' } },
  pendingActions: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TicketInclude;

const ticketListInclude = {
  customer: { select: { id: true, email: true, fullName: true } },
  order: { select: { id: true, code: true, status: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.TicketInclude;

export type TicketDetail = Prisma.TicketGetPayload<{
  include: typeof ticketDetailInclude;
}>;
export type TicketSummary = Prisma.TicketGetPayload<{
  include: typeof ticketListInclude;
}>;

/** Tầng truy cập dữ liệu cho ticket, tin nhắn, nhật ký tool và thao tác chờ duyệt. */
@Injectable()
export class TicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createWithMessage(data: {
    customerId: string;
    orderId?: string;
    subject: string;
    content: string;
  }): Promise<TicketDetail> {
    return this.prisma.ticket.create({
      data: {
        customerId: data.customerId,
        orderId: data.orderId,
        subject: data.subject,
        messages: {
          create: {
            authorType: MessageAuthor.CUSTOMER,
            authorId: data.customerId,
            content: data.content,
          },
        },
      },
      include: ticketDetailInclude,
    });
  }

  findById(id: string): Promise<TicketDetail | null> {
    return this.prisma.ticket.findUnique({
      where: { id },
      include: ticketDetailInclude,
    });
  }

  async findMany(params: {
    customerId?: string;
    status?: TicketStatus;
    category?: TicketCategory;
    skip: number;
    take: number;
  }): Promise<{ items: TicketSummary[]; total: number }> {
    const where: Prisma.TicketWhereInput = {
      customerId: params.customerId,
      status: params.status,
      category: params.category,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: ticketListInclude,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items, total };
  }

  addMessage(data: {
    ticketId: string;
    authorType: MessageAuthor;
    authorId?: string;
    content: string;
    internal?: boolean;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.ticketMessage.create({ data });
  }

  update(id: string, data: Prisma.TicketUncheckedUpdateInput) {
    return this.prisma.ticket.update({ where: { id }, data });
  }

  /** Ghi kết quả phân loại — KHÔNG ghi đè khi nhân viên đã phân loại tay (HUMAN). */
  async saveClassification(
    id: string,
    data: {
      category: TicketCategory;
      confidence: number;
      classifiedBy: ClassifiedBy;
    },
  ): Promise<boolean> {
    const { count } = await this.prisma.ticket.updateMany({
      where: {
        id,
        OR: [
          { classifiedBy: null },
          { classifiedBy: { not: ClassifiedBy.HUMAN } },
        ],
      },
      data: {
        category: data.category,
        categoryConfidence: data.confidence,
        classifiedBy: data.classifiedBy,
      },
    });
    return count === 1;
  }

  findTextForClassification(id: string) {
    return this.prisma.ticket.findUnique({
      where: { id },
      select: {
        subject: true,
        classifiedBy: true,
        messages: {
          where: { authorType: MessageAuthor.CUSTOMER },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });
  }

  recordToolCall(data: {
    ticketId: string;
    requestedById: string;
    toolName: string;
    input: Prisma.InputJsonValue;
    output: Prisma.InputJsonValue;
    success: boolean;
    durationMs: number;
  }) {
    return this.prisma.aiToolCall.create({ data });
  }

  createPendingAction(data: {
    ticketId: string;
    actionType: string;
    payload: Prisma.InputJsonValue;
    reason: string;
  }) {
    return this.prisma.aiPendingAction.create({ data });
  }

  findPendingAction(id: string) {
    return this.prisma.aiPendingAction.findUnique({ where: { id } });
  }

  /**
   * Chuyển PENDING → trạng thái mới, có điều kiện `status: PENDING`:
   * 2 nhân viên bấm duyệt cùng lúc thì chỉ 1 người thắng → thao tác không bị chạy 2 lần.
   */
  async claimPendingAction(
    id: string,
    reviewerId: string,
    status: PendingActionStatus,
  ): Promise<boolean> {
    const { count } = await this.prisma.aiPendingAction.updateMany({
      where: { id, status: PendingActionStatus.PENDING },
      data: { status, reviewedById: reviewerId, reviewedAt: new Date() },
    });
    return count === 1;
  }

  finishPendingAction(
    id: string,
    status: PendingActionStatus,
    result: Prisma.InputJsonValue,
  ) {
    return this.prisma.aiPendingAction.update({
      where: { id },
      data: { status, result },
    });
  }
}
