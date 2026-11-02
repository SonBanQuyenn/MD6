import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO + Redis adapter (TD-05).
 * Khi blue/green có 2 instance API, khách có thể nối vào instance A còn kho cập nhật qua instance B.
 * `server.to(room).emit()` ở B được publish qua Redis → A nhận và gửi tới đúng khách.
 *
 * Redis lỗi: sự kiện vẫn được gửi tới client nối CÙNG instance (adapter phát cục bộ trước),
 * chỉ mất phần chuyển tiếp sang instance khác. Client luôn gọi REST lấy trạng thái mới khi
 * kết nối lại nên không bị "kẹt" ở trạng thái cũ.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private readonly pubClient: Redis;
  private readonly subClient: Redis;

  constructor(app: INestApplicationContext, redisUrl: string) {
    super(app);
    // Kết nối RIÊNG: subscriber của Redis không chạy được lệnh thường, không dùng chung client cache.
    this.pubClient = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    this.subClient = this.pubClient.duplicate();
    for (const client of [this.pubClient, this.subClient]) {
      client.on('error', (err) =>
        this.logger.warn(`Redis adapter: ${err.message}`),
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    server.adapter(createAdapter(this.pubClient, this.subClient));
    return server;
  }

  /** app.close() → đóng 2 kết nối Redis (tránh treo tiến trình / test). */
  async dispose(): Promise<void> {
    await Promise.all(
      [this.pubClient, this.subClient].map((c) =>
        c.quit().catch(() => c.disconnect()),
      ),
    );
  }
}
