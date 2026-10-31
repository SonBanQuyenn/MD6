import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';

/**
 * Cấu hình chung cho ứng dụng. Dùng ở main.ts VÀ trong integration test
 * để test chạy đúng cấu hình như môi trường thật.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Mọi API nằm dưới /api → Nginx dễ phân biệt API với trang frontend.
  app.setGlobalPrefix('api');

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
