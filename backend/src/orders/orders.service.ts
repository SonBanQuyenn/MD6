import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { CatalogCacheInvalidator } from '../cache/catalog-cache';
import { CartRepository } from '../cart/cart.repository';
import { OutboxDispatcher } from '../jobs/outbox.dispatcher';
import { toCartView } from '../cart/cart.service';
import { Paginated } from '../common/dto/pagination-query.dto';
import { AuthUser } from '../common/types/auth-user';
import { PromotionsService } from '../promotions/promotions.service';
import { ListOrdersQueryDto, PlaceOrderDto } from './dto/order.dto';
import {
  OrderItemUnavailableError,
  OrderStatusConflictError,
  PromotionUnavailableError,
} from './order.errors';
import { OrderView, toOrderView } from './order.mapper';
import { canTransition, ORDER_STATUS_LABELS } from './order-state-machine';
import { OrderDetail, OrdersRepository } from './orders.repository';
import { calculateOrderTotals, MAX_ORDER_TOTAL } from './pricing';

/** Vai trò nhân viên được xem mọi đơn hàng. */
const STAFF_ROLES: Role[] = [
  Role.SUPPORT_AGENT,
  Role.WAREHOUSE_STAFF,
  Role.ADMIN,
];

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

export interface PlaceOrderResult {
  order: OrderView;
  /** true = request lặp lại với cùng Idempotency-Key → trả đơn đã tạo, không tạo mới */
  replayed: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly cart: CartRepository,
    private readonly promotions: PromotionsService,
    private readonly outbox: OutboxDispatcher,
    private readonly invalidator: CatalogCacheInvalidator,
  ) {}

  /**
   * Đặt đơn từ giỏ hàng (F06.2).
   * `promotionCode` chỉ được truyền từ endpoint POST /orders/promotional.
   */
  async placeOrder(
    userId: string,
    idempotencyKey: string | undefined,
    dto: PlaceOrderDto,
    promotionCode?: string,
  ): Promise<PlaceOrderResult> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException(
        'Thiếu hoặc sai header Idempotency-Key (8–100 ký tự: chữ, số, - hoặc _)',
      );
    }

    // Bấm "Đặt hàng" 2 lần / mạng gửi lại request → trả đơn cũ, KHÔNG tạo đơn thứ 2.
    const existing = await this.replay(userId, idempotencyKey);
    if (existing) return existing;

    const cart = toCartView(await this.cart.findItems(userId));
    if (cart.items.length === 0) {
      // Request "anh em" cùng key có thể vừa đặt xong và xoá giỏ → trả đơn đó, không báo lỗi.
      const winner = await this.replay(userId, idempotencyKey);
      if (winner) return winner;
      throw new BadRequestException('Giỏ hàng đang trống');
    }
    const problem = cart.items.find((line) => !line.available);
    if (problem) {
      const winner = await this.replay(userId, idempotencyKey);
      if (winner) return winner;
      throw new ConflictException({
        statusCode: 409,
        code: 'CART_ITEM_UNAVAILABLE',
        productId: problem.productId,
        message: `"${problem.name}": ${problem.warning}`,
      });
    }

    const promotion = promotionCode
      ? await this.promotions.getUsable(promotionCode)
      : null;
    const totals = calculateOrderTotals(cart.items, promotion);
    if (totals.total > MAX_ORDER_TOTAL) {
      throw new BadRequestException(
        'Giá trị đơn hàng vượt quá giới hạn cho phép',
      );
    }

    try {
      const order = await this.orders.placeOrder({
        userId,
        code: generateOrderCode(),
        idempotencyKey,
        paymentMethod: dto.paymentMethod,
        shippingAddress: { ...dto.shippingAddress },
        note: dto.note,
        lines: cart.items.map((line) => ({
          productId: line.productId,
          productName: line.name,
          sku: line.sku,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        })),
        totals,
        promotion: promotion
          ? { id: promotion.id, perUserLimit: promotion.perUserLimit }
          : undefined,
      });
      // Đẩy job lên hàng đợi NGAY (email, hoá đơn, đồng bộ kho…) — không chờ chúng chạy xong.
      // Hàng đợi lỗi cũng không sao: dispatcher không ném lỗi, sự kiện vẫn nằm trong outbox.
      // Tồn kho các sản phẩm vừa bị trừ → làm mới cache để khách khác thấy số mới.
      await this.invalidator.invalidateProducts(
        order.items.map((i) => i.productId),
      );
      await this.outbox.dispatchForOrder(order.id);
      return { order: toOrderView(order), replayed: false };
    } catch (error) {
      // Bất kỳ lỗi nào: nếu request cùng key đã tạo đơn thành công → trả đơn đó
      // (vd: request thua vấp UNIQUE, hoặc báo "hết lượt KM" vì chính request thắng vừa dùng).
      const winner = await this.replay(userId, idempotencyKey);
      if (winner) return winner;

      if (error instanceof OrderItemUnavailableError) {
        throw new ConflictException({
          statusCode: 409,
          code: error.reason,
          productId: error.productId,
          available: error.available,
          message: unavailableMessage(error),
        });
      }
      if (error instanceof PromotionUnavailableError) {
        throw new ConflictException(
          error.reason === 'USER_LIMIT'
            ? 'Bạn đã dùng hết lượt cho mã khuyến mãi này'
            : 'Mã khuyến mãi đã hết lượt hoặc hết hạn',
        );
      }
      throw error;
    }
  }

  /** Đã có đơn với key này → trả lại đơn đó (replay). */
  private async replay(
    userId: string,
    idempotencyKey: string,
  ): Promise<PlaceOrderResult | null> {
    const order = await this.orders.findByIdempotencyKey(
      userId,
      idempotencyKey,
    );
    return order ? { order: toOrderView(order), replayed: true } : null;
  }

  async listMine(
    userId: string,
    query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderView>> {
    return this.list({ ...query, userId });
  }

  async listAll(query: ListOrdersQueryDto): Promise<Paginated<OrderView>> {
    return this.list(query);
  }

  /** Khách chỉ xem được đơn của mình; nhân viên xem được mọi đơn. */
  async getForUser(user: AuthUser, orderId: string): Promise<OrderView> {
    return toOrderView(await this.loadAccessible(user, orderId));
  }

  /** Nhân viên kho / admin đổi trạng thái đơn theo máy trạng thái (F06.3). */
  async changeStatusByStaff(
    actor: AuthUser,
    orderId: string,
    to: OrderStatus,
    note?: string,
  ): Promise<OrderView> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');

    if (
      to === OrderStatus.CONFIRMED &&
      order.paymentMethod === PaymentMethod.MOCK_ONLINE &&
      order.paymentStatus !== PaymentStatus.PAID
    ) {
      throw new ConflictException(
        'Đơn thanh toán online chưa được thanh toán, chưa thể xác nhận',
      );
    }
    return this.transition(order, to, actor.id, note);
  }

  /** Khách tự huỷ đơn — chỉ khi đơn còn "Chờ xác nhận". */
  async cancelByCustomer(user: AuthUser, orderId: string): Promise<OrderView> {
    const order = await this.loadAccessible(user, orderId);
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        `Không thể huỷ đơn đang ở trạng thái "${ORDER_STATUS_LABELS[order.status]}", vui lòng liên hệ CSKH`,
      );
    }
    return this.transition(
      order,
      OrderStatus.CANCELLED,
      user.id,
      'Khách huỷ đơn',
    );
  }

  /**
   * Thanh toán GIẢ LẬP cho phương thức MOCK_ONLINE (chưa có cổng thanh toán thật —
   * SRS xếp vào định hướng tương lai). Thanh toán xong → đơn tự chuyển "Đã xác nhận".
   */
  async payByCustomer(user: AuthUser, orderId: string): Promise<OrderView> {
    const order = await this.loadAccessible(user, orderId);
    if (order.paymentMethod !== PaymentMethod.MOCK_ONLINE) {
      throw new BadRequestException(
        'Đơn này thanh toán khi nhận hàng (COD), không cần thanh toán online',
      );
    }
    if (order.paymentStatus !== PaymentStatus.UNPAID) {
      throw new ConflictException('Đơn hàng đã được thanh toán');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        'Đơn hàng không còn ở trạng thái chờ thanh toán',
      );
    }
    return this.transition(
      order,
      OrderStatus.CONFIRMED,
      user.id,
      'Thanh toán online (giả lập) thành công',
      { paymentStatus: PaymentStatus.PAID, paidAt: new Date() },
    );
  }

  private async transition(
    order: OrderDetail,
    to: OrderStatus,
    actorId: string,
    note?: string,
    extraOverride?: Prisma.OrderUncheckedUpdateManyInput,
  ): Promise<OrderView> {
    if (!canTransition(order.status, to)) {
      throw new ConflictException(
        `Không thể chuyển đơn từ "${ORDER_STATUS_LABELS[order.status]}" sang "${ORDER_STATUS_LABELS[to]}"`,
      );
    }

    const extra: Prisma.OrderUncheckedUpdateManyInput = { ...extraOverride };
    if (to === OrderStatus.CANCELLED) {
      extra.cancelledAt = new Date();
      if (order.paymentStatus === PaymentStatus.PAID) {
        extra.paymentStatus = PaymentStatus.REFUNDED; // hoàn tiền (giả lập)
      }
    }
    // COD: khách trả tiền lúc nhận hàng → giao thành công = đã thanh toán.
    if (
      to === OrderStatus.DELIVERED &&
      order.paymentMethod === PaymentMethod.COD
    ) {
      extra.paymentStatus = PaymentStatus.PAID;
      extra.paidAt = new Date();
    }

    try {
      const updated = await this.orders.changeStatus({
        orderId: order.id,
        from: order.status,
        to,
        actorId,
        note,
        restock: to === OrderStatus.CANCELLED,
        extra,
      });
      if (to === OrderStatus.CANCELLED) {
        // Đã hoàn kho → làm mới cache tồn kho
        await this.invalidator.invalidateProducts(
          updated.items.map((i) => i.productId),
        );
        await this.outbox.dispatchForOrder(order.id);
      }
      return toOrderView(updated);
    } catch (error) {
      if (error instanceof OrderStatusConflictError) {
        throw new ConflictException(
          'Trạng thái đơn hàng vừa được người khác cập nhật, vui lòng tải lại',
        );
      }
      throw error;
    }
  }

  /** Hoá đơn HTML do job nền tạo. Chưa tạo xong → 404 kèm lời nhắn thử lại sau. */
  async getInvoiceHtml(user: AuthUser, orderId: string): Promise<string> {
    await this.loadAccessible(user, orderId);
    const invoice = await this.orders.findInvoice(orderId);
    if (!invoice) {
      throw new NotFoundException(
        'Hoá đơn đang được tạo, vui lòng thử lại sau ít phút',
      );
    }
    return invoice.html;
  }

  private async loadAccessible(
    user: AuthUser,
    orderId: string,
  ): Promise<OrderDetail> {
    const order = await this.orders.findById(orderId);
    const isStaff = STAFF_ROLES.includes(user.role);
    // Trả 404 (không phải 403) khi khách xem đơn của người khác
    // → không tiết lộ cho kẻ dò ID biết đơn đó có tồn tại.
    if (!order || (!isStaff && order.userId !== user.id)) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    return order;
  }

  private async list(
    query: ListOrdersQueryDto & { userId?: string },
  ): Promise<Paginated<OrderView>> {
    const { page, limit, status, userId } = query;
    const { items, total } = await this.orders.findMany({
      userId,
      status,
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: items.map(toOrderView),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}

function unavailableMessage(error: OrderItemUnavailableError): string {
  const name = `"${error.productName}"`;
  switch (error.reason) {
    case 'NOT_FOUND':
    case 'INACTIVE':
      return `${name} đã ngừng bán, vui lòng xoá khỏi giỏ hàng`;
    case 'PRICE_CHANGED':
      return `Giá của ${name} vừa thay đổi, vui lòng kiểm tra lại giỏ hàng`;
    case 'OUT_OF_STOCK':
      return error.available === 0
        ? `${name} đã hết hàng`
        : `${name} chỉ còn ${error.available} sản phẩm`;
  }
}

/** Mã đơn dễ đọc: SF-<ngày giờ VN>-<8 ký tự ngẫu nhiên>, ví dụ SF-20261101-9F3A1C7B */
export function generateOrderCode(now = new Date()): string {
  const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  return `SF-${vnDate}-${randomBytes(4).toString('hex').toUpperCase()}`;
}
