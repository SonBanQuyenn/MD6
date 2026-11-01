import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.validation';

/**
 * Cấu hình dùng chung cho CẢ tiến trình API (main.ts) và tiến trình worker (worker.ts)
 * → hai tiến trình luôn đọc & kiểm tra biến môi trường giống hệt nhau.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Chạy cục bộ: đọc file .env ở thư mục gốc repo.
      // Trong Docker/CI: không có file, biến môi trường được truyền trực tiếp.
      envFilePath: ['../.env', '.env'],
      validationSchema: envValidationSchema,
    }),
  ],
})
export class AppConfigModule {}
