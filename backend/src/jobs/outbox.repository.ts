import { Injectable } from '@nestjs/common';
import { JobOutbox } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Sự kiện chưa được đẩy lên hàng đợi (cũ nhất trước). */
  findPending(params: {
    orderId?: string;
    createdBefore?: Date;
    limit: number;
  }): Promise<JobOutbox[]> {
    return this.prisma.jobOutbox.findMany({
      where: {
        dispatchedAt: null,
        orderId: params.orderId,
        createdAt: params.createdBefore
          ? { lt: params.createdBefore }
          : undefined,
      },
      orderBy: { createdAt: 'asc' },
      take: params.limit,
    });
  }

  async markDispatched(id: string): Promise<void> {
    await this.prisma.jobOutbox.update({
      where: { id },
      data: { dispatchedAt: new Date(), lastError: null },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.jobOutbox.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 1000) },
    });
  }

  countPending(): Promise<number> {
    return this.prisma.jobOutbox.count({ where: { dispatchedAt: null } });
  }
}
