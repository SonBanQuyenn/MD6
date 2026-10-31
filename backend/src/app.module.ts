import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

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
  ],
})
export class AppModule {}
