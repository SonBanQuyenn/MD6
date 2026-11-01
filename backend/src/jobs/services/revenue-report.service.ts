import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { EmailService } from '../../mail/email.service';
import { dailyRevenueEmail } from '../../mail/templates';
import { JobDataRepository } from '../job-data.repository';
import { JOBS } from '../queues';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Việt Nam = UTC+7, không có giờ mùa hè

/** Ngày hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function vnToday(now = new Date()): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Khoảng [00:00, 24:00) của một ngày giờ Việt Nam, quy ra UTC để truy vấn DB. */
export function vnDayRange(date: string): { from: Date; to: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    throw new BadRequestException('Ngày phải có dạng YYYY-MM-DD');
  }
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - VN_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

export interface RevenueSummary {
  orderCount: number;
  cancelledCount: number;
  revenue: bigint;
  breakdown: Record<string, { count: number; total: number }>;
}

/** Doanh thu = tổng tiền các đơn KHÔNG bị huỷ tạo trong ngày. */
export function summarize(
  groups: {
    status: OrderStatus;
    _count: { _all: number };
    _sum: { total: number | null };
  }[],
): RevenueSummary {
  const summary: RevenueSummary = {
    orderCount: 0,
    cancelledCount: 0,
    revenue: 0n,
    breakdown: {},
  };
  for (const g of groups) {
    const total = g._sum.total ?? 0;
    summary.breakdown[g.status] = { count: g._count._all, total };
    if (g.status === OrderStatus.CANCELLED) {
      summary.cancelledCount += g._count._all;
    } else {
      summary.orderCount += g._count._all;
      summary.revenue += BigInt(total);
    }
  }
  return summary;
}

@Injectable()
export class RevenueReportService {
  constructor(
    private readonly data: JobDataRepository,
    private readonly email: EmailService,
  ) {}

  /**
   * Tạo (hoặc cập nhật) báo cáo của 1 ngày và gửi email cho admin.
   * Chạy lại nhiều lần: báo cáo được UPSERT theo ngày, email chống trùng theo (ngày, admin).
   */
  async generate(date = vnToday()) {
    const { from, to } = vnDayRange(date);
    const summary = summarize(await this.data.revenueByStatus(from, to));

    const report = await this.data.upsertDailyReport({
      reportDate: new Date(`${date}T00:00:00Z`),
      orderCount: summary.orderCount,
      cancelledCount: summary.cancelledCount,
      revenue: summary.revenue,
      breakdown: summary.breakdown,
    });

    const { subject, html } = dailyRevenueEmail({ date, ...summary });
    const admins = await this.data.findActiveAdmins();
    for (const admin of admins) {
      await this.email.sendOnce({
        dedupeKey: `daily-report-${date}-${admin.id}`,
        type: JOBS.DAILY_REVENUE_REPORT,
        to: admin.email,
        subject,
        html,
      });
    }
    return {
      date,
      orderCount: report.orderCount,
      cancelledCount: report.cancelledCount,
      revenue: report.revenue.toString(),
      emailedAdmins: admins.length,
    };
  }
}
