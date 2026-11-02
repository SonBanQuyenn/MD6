import { Module } from '@nestjs/common';
import { OrderAccessRepository } from './order-access.repository';
import { OrderEventsPublisher } from './order-events.publisher';
import { OrdersGateway } from './orders.gateway';

/** F02 — kênh realtime (Socket.IO). JwtService đến từ JwtModule global của AuthModule. */
@Module({
  providers: [OrdersGateway, OrderAccessRepository, OrderEventsPublisher],
  exports: [OrderEventsPublisher],
})
export class RealtimeModule {}
