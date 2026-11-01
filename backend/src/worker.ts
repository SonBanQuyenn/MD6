import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './jobs/worker.module';

/**
 * Tiến trình WORKER: không mở cổng HTTP, chỉ lấy job từ Redis và xử lý.
 * Chạy: npm run start:worker (production) / npm run start:worker:dev (dev)
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // docker stop → SIGTERM → worker làm xong job đang chạy rồi mới thoát.
  app.enableShutdownHooks();
  Logger.log('ShopFast worker đang chạy, chờ job…', 'Worker');
}
bootstrap();
