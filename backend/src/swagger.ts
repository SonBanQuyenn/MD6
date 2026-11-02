import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Tài liệu API sinh tự động (F07.3): UI tại /api/docs, OpenAPI JSON tại /api/docs-json.
 * Schema của DTO được plugin @nestjs/swagger (nest-cli.json) sinh từ kiểu TypeScript +
 * decorator class-validator + chú thích JSDoc — không phải viết tay, nên không lệch với code.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('ShopFast API')
    .setDescription(
      'Backend sàn thương mại điện tử ShopFast. Đăng nhập ở `POST /api/auth/login`, ' +
        'bấm **Authorize** và dán `accessToken`. Realtime: Socket.IO tại `/api/socket.io` ' +
        '(xem README). Lỗi 429 = vượt hạn mức, xem header `Retry-After`.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'ShopFast API docs',
    swaggerOptions: { persistAuthorization: true },
  });
}
