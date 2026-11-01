import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CatalogModule } from './catalog/catalog.module';
import { CacheModule } from './cache/cache.module';
import { AppConfigModule } from './config/app-config.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { JobsAdminModule } from './jobs/admin/jobs-admin.module';
import { JobsModule } from './jobs/jobs.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromotionsModule } from './promotions/promotions.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    CacheModule,
    // API chỉ THÊM job vào hàng đợi; xử lý job nằm ở tiến trình worker (src/worker.ts)
    JobsModule.forRoot('producer'),
    HealthModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    InventoryModule,
    CartModule,
    PromotionsModule,
    OrdersModule,
    JobsAdminModule,
  ],
})
export class AppModule {}
