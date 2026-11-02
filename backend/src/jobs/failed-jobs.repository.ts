import { Injectable } from '@nestjs/common';
import { FailedJob, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FailedJobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  record(data: {
    queue: string;
    jobId: string;
    jobName: string;
    payload: Prisma.InputJsonValue;
    failedReason: string;
    stacktrace?: string;
    attemptsMade: number;
  }): Promise<FailedJob> {
    return this.prisma.failedJob.create({ data });
  }

  findById(id: string): Promise<FailedJob | null> {
    return this.prisma.failedJob.findUnique({ where: { id } });
  }

  async findMany(params: {
    queue?: string;
    skip: number;
    take: number;
  }): Promise<{ items: FailedJob[]; total: number }> {
    const where: Prisma.FailedJobWhereInput = { queue: params.queue };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.failedJob.findMany({
        where,
        orderBy: { failedAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.failedJob.count({ where }),
    ]);
    return { items, total };
  }

  markRetried(id: string): Promise<FailedJob> {
    return this.prisma.failedJob.update({
      where: { id },
      data: { retriedAt: new Date() },
    });
  }
}
