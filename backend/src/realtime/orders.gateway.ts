import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Role } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { AccessTokenPayload, AuthUser } from '../common/types/auth-user';
import { OrderAccessRepository } from './order-access.repository';
import {
  orderRoom,
  OrderStatusEvent,
  SubscribeAck,
  WS_EVENTS,
} from './realtime.events';

const STAFF_ROLES: Role[] = [
  Role.SUPPORT_AGENT,
  Role.WAREHOUSE_STAFF,
  Role.ADMIN,
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthedSocket = Socket & { data: { user: AuthUser } };

/**
 * F02 — Theo dõi đơn hàng thời gian thực.
 *  - Xác thực JWT NGAY LÚC BẮT TAY (middleware) → không có token hợp lệ thì không kết nối được.
 *  - Khách chỉ join được phòng của đơn thuộc về mình; nhân viên join được mọi đơn.
 *  - Sự kiện chỉ phát vào phòng `order:<id>` — KHÔNG BAO GIỜ `server.emit` toàn cục.
 *
 * Đường dẫn `/api/socket.io` → Nginx / Vite chỉ cần chuyển tiếp mọi thứ dưới `/api`.
 * Token đi trong `auth` của handshake (không qua cookie) → trang web lạ không thể "mượn" phiên
 * của khách để mở kết nối (cross-site WebSocket hijacking).
 */
@WebSocketGateway({ path: '/api/socket.io' })
export class OrdersGateway implements OnGatewayInit {
  private readonly logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly orders: OrderAccessRepository,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticate(socket)
        .then((user) => {
          socket.data.user = user;
          next();
        })
        .catch(() => next(new Error('UNAUTHORIZED')));
    });
  }

  /** Khách xin theo dõi 1 đơn. Trả kết quả qua "ack" (callback) của Socket.IO. */
  @SubscribeMessage(WS_EVENTS.SUBSCRIBE)
  async subscribe(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { orderId?: unknown },
  ): Promise<SubscribeAck> {
    const orderId = body?.orderId;
    if (typeof orderId !== 'string' || !UUID.test(orderId)) {
      return { ok: false, error: 'INVALID' };
    }
    const order = await this.orders.findOwner(orderId);
    const user = socket.data.user;
    const allowed =
      order && (order.userId === user.id || STAFF_ROLES.includes(user.role));
    if (!order || !allowed) {
      // Không phân biệt "không tồn tại" và "không phải của bạn" → không dò được id đơn.
      return { ok: false, error: 'FORBIDDEN' };
    }
    await socket.join(orderRoom(orderId));
    return { ok: true, orderId, status: order.status };
  }

  @SubscribeMessage(WS_EVENTS.UNSUBSCRIBE)
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { orderId?: unknown },
  ): Promise<{ ok: true }> {
    if (typeof body?.orderId === 'string') {
      await socket.leave(orderRoom(body.orderId));
    }
    return { ok: true };
  }

  /** Gọi từ OrdersService sau khi đổi trạng thái thành công. */
  emitStatus(event: OrderStatusEvent): void {
    // server chưa sẵn sàng (vd: chạy trong worker / unit test) → bỏ qua
    if (!this.server) return;
    this.server.to(orderRoom(event.orderId)).emit(WS_EVENTS.STATUS, event);
  }

  private async authenticate(socket: Socket): Promise<AuthUser> {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('missing token');
    }
    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
