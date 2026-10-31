import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Mọi API nằm dưới /api → Nginx dễ phân biệt API với trang frontend.
  app.setGlobalPrefix('api');
  // Nhận SIGTERM (docker stop) → đóng kết nối DB/Redis gọn gàng.
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`ShopFast API chạy tại http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
