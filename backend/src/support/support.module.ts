import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { AiModule } from './ai/ai.module';
import { AssistantService } from './assistant.service';
import { PendingActionsService } from './pending-actions.service';
import { SupportTools } from './support-tools';
import { SupportController } from './support.controller';
import { TicketClassifierService } from './ticket-classifier.service';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

/** F01 — Hỗ trợ khách hàng + trợ lý AI cho nhân viên CSKH. */
@Module({
  imports: [AiModule, OrdersModule, CatalogModule],
  controllers: [SupportController],
  providers: [
    TicketsRepository,
    TicketsService,
    TicketClassifierService,
    SupportTools,
    AssistantService,
    PendingActionsService,
  ],
})
export class SupportModule {}
