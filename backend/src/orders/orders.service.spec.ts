import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Promotion,
  Role,
} from '@prisma/client';
import { CartItemWithProduct, CartRepository } from '../cart/cart.repository';
import { AuthUser } from '../common/types/auth-user';
import { CatalogCacheInvalidator } from '../cache/catalog-cache';
import { OutboxDispatcher } from '../jobs/outbox.dispatcher';
import { PromotionsService } from '../promotions/promotions.service';
import {
  OrderItemUnavailableError,
  OrderStatusConflictError,
  PromotionUnavailableError,
} from './order.errors';
import { OrderDetail, OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

const customer: AuthUser = { id: 'u1', email: 'c@x.com', role: Role.CUSTOMER };
const otherCustomer: AuthUser = {
  id: 'u2',
  email: 'o@x.com',
  role: Role.CUSTOMER,
};
const warehouse: AuthUser = {
  id: 'w1',
  email: 'w@x.com',
  role: Role.WAREHOUSE_STAFF,
};

const cartItem = (
  overrides: Partial<CartItemWithProduct['product']> = {},
  quantity = 2,
): CartItemWithProduct => ({
  id: 'ci1',
  userId: 'u1',
  productId: 'p1',
  quantity,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: {
    id: 'p1',
    sku: 'SKU-1',
    name: 'Tai nghe',
    price: 100_000,
    stock: 10,
    isActive: true,
    imageUrl: null,
    ...overrides,
  },
});

const order = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
  id: 'o1',
  code: 'SF-20261101-AAAAAAAA',
  userId: 'u1',
  status: OrderStatus.PENDING,
  paymentStatus: PaymentStatus.UNPAID,
  paymentMethod: PaymentMethod.COD,
  subtotal: 200_000,
  discount: 0,
  total: 200_000,
  promotionId: null,
  idempotencyKey: 'key-12345678',
  shippingAddress: {},
  note: null,
  paidAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
  promotion: null,
  statusHistory: [],
  ...overrides,
});

const dto = {
  paymentMethod: PaymentMethod.COD,
  shippingAddress: {
    fullName: 'Khách',
    phone: '0912345678',
    addressLine: '1 Lê Lợi',
    city: 'Hà Nội',
  },
};

describe('OrdersService', () => {
  let orders: jest.Mocked<
    Pick<
      OrdersRepository,
      | 'placeOrder'
      | 'findByIdempotencyKey'
      | 'findById'
      | 'changeStatus'
      | 'findMany'
    >
  >;
  let cart: jest.Mocked<Pick<CartRepository, 'findItems'>>;
  let promotions: jest.Mocked<Pick<PromotionsService, 'getUsable'>>;
  let outbox: jest.Mocked<Pick<OutboxDispatcher, 'dispatchForOrder'>>;
  let service: OrdersService;

  beforeEach(() => {
    orders = {
      placeOrder: jest.fn().mockResolvedValue(order()),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(order()),
      changeStatus: jest.fn().mockResolvedValue(order()),
      findMany: jest.fn(),
    };
    cart = { findItems: jest.fn().mockResolvedValue([cartItem()]) };
    promotions = { getUsable: jest.fn() };
    outbox = {
      dispatchForOrder: jest
        .fn()
        .mockResolvedValue({ dispatched: 1, failed: 0 }),
    };
    service = new OrdersService(
      orders as unknown as OrdersRepository,
      cart as unknown as CartRepository,
      promotions as unknown as PromotionsService,
      outbox as unknown as OutboxDispatcher,
      { invalidateProducts: jest.fn() } as unknown as CatalogCacheInvalidator,
    );
  });

  describe('placeOrder', () => {
    it('thiếu / sai Idempotency-Key → 400', async () => {
      await expect(
        service.placeOrder('u1', undefined, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.placeOrder('u1', 'ngắn', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('tính tiền ở server từ giá trong DB và gửi đúng dữ liệu xuống repository', async () => {
      await service.placeOrder('u1', 'key-12345678', dto);

      expect(orders.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          idempotencyKey: 'key-12345678',
          totals: { subtotal: 200_000, discount: 0, total: 200_000 },
          lines: [
            {
              productId: 'p1',
              productName: 'Tai nghe',
              sku: 'SKU-1',
              unitPrice: 100_000,
              quantity: 2,
            },
          ],
          promotion: undefined,
        }),
      );
    });

    it('đặt đơn thành công → đẩy sự kiện outbox lên hàng đợi (không chờ job chạy)', async () => {
      await service.placeOrder('u1', 'key-12345678', dto);
      expect(outbox.dispatchForOrder).toHaveBeenCalledWith('o1');
    });

    it('cùng Idempotency-Key đã có đơn → trả đơn cũ, KHÔNG tạo đơn mới', async () => {
      orders.findByIdempotencyKey.mockResolvedValue(order());

      const result = await service.placeOrder('u1', 'key-12345678', dto);

      expect(result.replayed).toBe(true);
      expect(orders.placeOrder).not.toHaveBeenCalled();
      expect(outbox.dispatchForOrder).not.toHaveBeenCalled();
    });

    it('2 request trùng key chạy song song (lỗi UNIQUE) → trả đơn của request thắng', async () => {
      orders.placeOrder.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      orders.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(order());

      const result = await service.placeOrder('u1', 'key-12345678', dto);

      expect(result.replayed).toBe(true);
    });

    it('request cùng key thua cuộc thấy giỏ đã bị xoá → trả đơn của request thắng, không báo lỗi', async () => {
      cart.findItems.mockResolvedValue([]);
      orders.findByIdempotencyKey
        .mockResolvedValueOnce(null) // lúc đầu chưa có đơn
        .mockResolvedValueOnce(order()); // request thắng vừa commit xong

      const result = await service.placeOrder('u1', 'key-12345678', dto);

      expect(result.replayed).toBe(true);
    });

    it('mã KM báo hết lượt nhưng chính request cùng key vừa dùng → trả đơn đó', async () => {
      promotions.getUsable.mockResolvedValue({
        id: 'promo1',
        discountPercent: 10,
        maxDiscount: null,
        perUserLimit: 1,
      } as Promotion);
      orders.placeOrder.mockRejectedValue(
        new PromotionUnavailableError('USER_LIMIT'),
      );
      orders.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(order());

      const result = await service.placeOrder(
        'u1',
        'key-12345678',
        dto,
        'GIAM10',
      );
      expect(result.replayed).toBe(true);
    });

    it('giỏ rỗng → 400', async () => {
      cart.findItems.mockResolvedValue([]);
      await expect(
        service.placeOrder('u1', 'key-12345678', dto),
      ).rejects.toThrow('Giỏ hàng đang trống');
    });

    it('sản phẩm trong giỏ đã hết hàng → 409 trước khi vào transaction', async () => {
      cart.findItems.mockResolvedValue([cartItem({ stock: 1 }, 2)]);
      await expect(
        service.placeOrder('u1', 'key-12345678', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orders.placeOrder).not.toHaveBeenCalled();
    });

    it('transaction báo hết hàng (bị người khác mua trước) → 409 kèm số lượng còn lại', async () => {
      orders.placeOrder.mockRejectedValue(
        new OrderItemUnavailableError('p1', 'Tai nghe', 'OUT_OF_STOCK', 1),
      );

      const error = await service
        .placeOrder('u1', 'key-12345678', dto)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        code: 'OUT_OF_STOCK',
        available: 1,
        message: '"Tai nghe" chỉ còn 1 sản phẩm',
      });
    });

    it('áp mã khuyến mãi: giảm giá đúng và truyền promotion xuống repository', async () => {
      promotions.getUsable.mockResolvedValue({
        id: 'promo1',
        discountPercent: 10,
        maxDiscount: null,
        perUserLimit: 1,
      } as Promotion);

      await service.placeOrder('u1', 'key-12345678', dto, 'GIAM10');

      expect(orders.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          totals: { subtotal: 200_000, discount: 20_000, total: 180_000 },
          promotion: { id: 'promo1', perUserLimit: 1 },
        }),
      );
    });

    it('mã KM hết lượt trong transaction → 409', async () => {
      promotions.getUsable.mockResolvedValue({
        id: 'promo1',
        discountPercent: 10,
        maxDiscount: null,
        perUserLimit: 1,
      } as Promotion);
      orders.placeOrder.mockRejectedValue(
        new PromotionUnavailableError('SOLD_OUT_OR_EXPIRED'),
      );

      await expect(
        service.placeOrder('u1', 'key-12345678', dto, 'GIAM10'),
      ).rejects.toThrow('Mã khuyến mãi đã hết lượt hoặc hết hạn');
    });
  });

  describe('xem đơn', () => {
    it('khách xem đơn của người khác → 404 (không tiết lộ đơn có tồn tại)', async () => {
      await expect(
        service.getForUser(otherCustomer, 'o1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('nhân viên xem được đơn của bất kỳ khách nào', async () => {
      await expect(service.getForUser(warehouse, 'o1')).resolves.toMatchObject({
        id: 'o1',
      });
    });
  });

  describe('đổi trạng thái', () => {
    it('chuyển hợp lệ PENDING → CONFIRMED (COD)', async () => {
      await service.changeStatusByStaff(warehouse, 'o1', OrderStatus.CONFIRMED);

      expect(orders.changeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          from: OrderStatus.PENDING,
          to: OrderStatus.CONFIRMED,
          restock: false,
        }),
      );
    });

    it('chuyển sai máy trạng thái → 409', async () => {
      await expect(
        service.changeStatusByStaff(warehouse, 'o1', OrderStatus.DELIVERED),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orders.changeStatus).not.toHaveBeenCalled();
    });

    it('không xác nhận đơn online chưa thanh toán', async () => {
      orders.findById.mockResolvedValue(
        order({ paymentMethod: PaymentMethod.MOCK_ONLINE }),
      );
      await expect(
        service.changeStatusByStaff(warehouse, 'o1', OrderStatus.CONFIRMED),
      ).rejects.toThrow('chưa được thanh toán');
    });

    it('huỷ đơn → hoàn kho; đơn đã thanh toán → REFUNDED', async () => {
      orders.findById.mockResolvedValue(
        order({
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
        }),
      );

      await service.changeStatusByStaff(warehouse, 'o1', OrderStatus.CANCELLED);

      expect(orders.changeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          restock: true,
          extra: expect.objectContaining({
            paymentStatus: PaymentStatus.REFUNDED,
            cancelledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('giao thành công đơn COD → tự đánh dấu đã thanh toán', async () => {
      orders.findById.mockResolvedValue(
        order({ status: OrderStatus.SHIPPING }),
      );

      await service.changeStatusByStaff(warehouse, 'o1', OrderStatus.DELIVERED);

      expect(orders.changeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({
            paymentStatus: PaymentStatus.PAID,
            paidAt: expect.any(Date),
          }),
        }),
      );
    });

    it('người khác vừa đổi trạng thái → 409 thân thiện', async () => {
      orders.changeStatus.mockRejectedValue(new OrderStatusConflictError());
      await expect(
        service.changeStatusByStaff(warehouse, 'o1', OrderStatus.CONFIRMED),
      ).rejects.toThrow('vừa được người khác cập nhật');
    });

    it('huỷ đơn → đẩy sự kiện đồng bộ kho; đổi trạng thái khác → không', async () => {
      await service.changeStatusByStaff(warehouse, 'o1', OrderStatus.CONFIRMED);
      expect(outbox.dispatchForOrder).not.toHaveBeenCalled();

      await service.changeStatusByStaff(warehouse, 'o1', OrderStatus.CANCELLED);
      expect(outbox.dispatchForOrder).toHaveBeenCalledWith('o1');
    });

    it('khách chỉ huỷ được đơn đang chờ xác nhận', async () => {
      orders.findById.mockResolvedValue(
        order({ status: OrderStatus.CONFIRMED }),
      );
      await expect(
        service.cancelByCustomer(customer, 'o1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('thanh toán giả lập: chỉ cho MOCK_ONLINE chưa thanh toán', async () => {
      await expect(service.payByCustomer(customer, 'o1')).rejects.toThrow(
        'COD',
      );

      orders.findById.mockResolvedValue(
        order({ paymentMethod: PaymentMethod.MOCK_ONLINE }),
      );
      await service.payByCustomer(customer, 'o1');
      expect(orders.changeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          to: OrderStatus.CONFIRMED,
          extra: expect.objectContaining({
            paymentStatus: PaymentStatus.PAID,
          }),
        }),
      );
    });
  });
});
