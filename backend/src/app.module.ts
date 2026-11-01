import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CatalogModule } from './catalog/catalog.module';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromotionsModule } from './promotions/promotions.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Chạy cục bộ: đọc file .env ở thư mục gốc repo.
      // Trong Docker/CI: không có file, biến môi trường được truyền trực tiếp.
      envFilePath: ['../.env', '.env'],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    InventoryModule,
    CartModule,
    PromotionsModule,
    OrdersModule,
  ],
})
export class AppModule {}
