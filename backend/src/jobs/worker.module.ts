import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { JobDataRepository } from './job-data.repository';
import { JobsModule } from './jobs.module';
import {
  EmailProcessor,
  InventorySyncProcessor,
  InvoiceProcessor,
  ScheduledProcessor,
} from './processors/processors';
import { JobSchedules } from './schedules';
import { InventorySyncService } from './services/inventory-sync.service';
import { InvoiceService } from './services/invoice.service';
import { OrderNotificationsService } from './services/order-notifications.service';
import { PartnerInventoryClient } from './services/partner-inventory.client';
import { RevenueReportService } from './services/revenue-report.service';

/**
 * Module gốc của TIẾN TRÌNH WORKER (src/worker.ts) — tách khỏi API:
 * job nặng (gửi mail, gọi đối tác) không chiếm CPU của API, và worker chết
 * thì API vẫn nhận đơn bình thường, job nằm chờ trong Redis.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    MailModule,
    JobsModule.forRoot('worker'),
  ],
  providers: [
    JobDataRepository,
    OrderNotificationsService,
    InvoiceService,
    PartnerInventoryClient,
    InventorySyncService,
    RevenueReportService,
    EmailProcessor,
    InvoiceProcessor,
    InventorySyncProcessor,
    ScheduledProcessor,
    JobSchedules,
  ],
})
export class WorkerModule {}
