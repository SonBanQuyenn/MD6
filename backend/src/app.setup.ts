import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

/**
 * Cấu hình chung cho ứng dụng. Dùng ở main.ts VÀ trong integration test
 * để test chạy đúng cấu hình như môi trường thật.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Mọi API nằm dưới /api → Nginx dễ phân biệt API với trang frontend.
  app.setGlobalPrefix('api');

  // Sau Nginx: tin đúng N proxy để `req.ip` là IP thật của khách (rate limit theo IP — F03.2).
  const trustProxy = app.get(ConfigService).get<number>('TRUST_PROXY', 0);
  if (trustProxy > 0) {
    (app as NestExpressApplication).set('trust proxy', trustProxy);
  }

  // Socket.IO dùng Redis adapter → sự kiện realtime tới được client ở mọi instance API (F02, TD-05).
  app.useWebSocketAdapter(
    new RedisIoAdapter(app, app.get(ConfigService).getOrThrow('REDIS_URL')),
  );

  // Đọc cookie (refresh token nằm trong cookie httpOnly).
  app.use(cookieParser());

  // Kiểm tra dữ liệu đầu vào bằng các decorator trong DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // bỏ các field không khai báo trong DTO
      forbidNonWhitelisted: true, // ...và báo lỗi nếu client cố gửi field lạ (vd: role)
      transform: true, // chuyển "1" → 1 theo kiểu khai báo trong DTO
    }),
  );

  // Nhận SIGTERM (docker stop) → đóng kết nối DB/Redis gọn gàng.
  app.enableShutdownHooks();
  return app;
}
