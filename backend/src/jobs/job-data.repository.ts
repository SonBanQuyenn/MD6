import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const orderForJobsInclude = {
  items: true,
  user: { select: { email: true, fullName: true } },
} satisfies Prisma.OrderInclude;

export type OrderForJobs = Prisma.OrderGetPayload<{
  include: typeof orderForJobsInclude;
}>;

/** Truy vấn dữ liệu mà các job nền cần (tầng truy cập dữ liệu của worker). */
@Injectable()
export class JobDataRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOrder(orderId: string): Promise<OrderForJobs | null> {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderForJobsInclude,
    });
  }

  findInvoiceByOrder(orderId: string) {
    return this.prisma.invoice.findUnique({ where: { orderId } });
  }

  createInvoice(data: {
    orderId: string;
    number: string;
    total: number;
    html: string;
  }) {
    return this.prisma.invoice.create({ data });
  }

  findSyncLog(dedupeKey: string) {
    return this.prisma.inventorySyncLog.findUnique({ where: { dedupeKey } });
  }

  createSyncLog(data: {
    dedupeKey: string;
    orderId: string;
    payload: Prisma.InputJsonValue;
    partnerRef: string;
  }) {
    return this.prisma.inventorySyncLog.create({ data });
  }

  productStocks(productIds: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, stock: true },
      orderBy: { sku: 'asc' },
    });
  }

  /** Đếm đơn + cộng tiền theo trạng thái trong khoảng thời gian [from, to). */
  revenueByStatus(from: Date, to: Date) {
    return this.prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { total: true },
    });
  }

  upsertDailyReport(data: {
    reportDate: Date;
    orderCount: number;
    cancelledCount: number;
    revenue: bigint;
    breakdown: Prisma.InputJsonValue;
  }) {
    return this.prisma.dailyRevenueReport.upsert({
      where: { reportDate: data.reportDate },
      create: data,
      update: data,
    });
  }

  findActiveAdmins() {
    return this.prisma.user.findMany({
      where: { role: Role.ADMIN, isActive: true },
      select: { id: true, email: true },
    });
  }
}
