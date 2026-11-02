import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CartItemWithProduct, CartRepository } from './cart.repository';
import { CartService, toCartView } from './cart.service';

const line = (
  product: Partial<CartItemWithProduct['product']>,
  quantity: number,
): CartItemWithProduct => ({
  id: 'ci',
  userId: 'u1',
  productId: product.id ?? 'p1',
  quantity,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: {
    id: 'p1',
    sku: 'S',
    name: 'SP',
    price: 50_000,
    stock: 10,
    isActive: true,
    imageUrl: null,
    ...product,
  },
});

describe('toCartView', () => {
  it('tính thành tiền, tổng số lượng và cho phép thanh toán khi mọi dòng hợp lệ', () => {
    const view = toCartView([
      line({ id: 'a', price: 50_000 }, 2),
      line({ id: 'b', price: 20_000 }, 3),
    ]);
    expect(view).toMatchObject({
      itemCount: 5,
      subtotal: 160_000,
      canCheckout: true,
    });
    expect(view.items[0].lineTotal).toBe(100_000);
  });

  it.each([
    [{ isActive: false }, 1, 'Sản phẩm đã ngừng bán'],
    [{ stock: 0 }, 1, 'Sản phẩm đã hết hàng'],
    [{ stock: 2 }, 5, 'Chỉ còn 2 sản phẩm'],
  ])('cảnh báo %p (số lượng %p) → "%s" và chặn thanh toán', (p, q, warning) => {
    const view = toCartView([line(p, q)]);
    expect(view.items[0]).toMatchObject({ available: false, warning });
    expect(view.canCheckout).toBe(false);
  });

  it('giỏ rỗng → không thanh toán được', () => {
    expect(toCartView([]).canCheckout).toBe(false);
  });
});

describe('CartService', () => {
  let repo: jest.Mocked<
    Pick<
      CartRepository,
      'findItems' | 'findItem' | 'findProduct' | 'setQuantity' | 'removeItem'
    >
  >;
  let service: CartService;

  beforeEach(() => {
    repo = {
      findItems: jest.fn().mockResolvedValue([]),
      findItem: jest.fn().mockResolvedValue(null),
      findProduct: jest
        .fn()
        .mockResolvedValue({ id: 'p1', name: 'SP', stock: 5, isActive: true }),
      setQuantity: jest.fn(),
      removeItem: jest.fn().mockResolvedValue(1),
    };
    service = new CartService(repo as unknown as CartRepository);
  });

  it('thêm sản phẩm đã có trong giỏ → cộng dồn số lượng', async () => {
    repo.findItem.mockResolvedValue({ quantity: 2 } as never);

    await service.addItem('u1', 'p1', 3);

    expect(repo.setQuantity).toHaveBeenCalledWith('u1', 'p1', 5);
  });

  it('vượt tồn kho → 409 với số lượng còn lại', async () => {
    await expect(service.addItem('u1', 'p1', 6)).rejects.toThrow(
      '"SP" chỉ còn 5 sản phẩm',
    );
    expect(repo.setQuantity).not.toHaveBeenCalled();
  });

  it('sản phẩm hết hàng → 409', async () => {
    repo.findProduct.mockResolvedValue({
      id: 'p1',
      name: 'SP',
      stock: 0,
      isActive: true,
    });
    await expect(service.addItem('u1', 'p1', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('cộng dồn vượt 99 → 400', async () => {
    repo.findProduct.mockResolvedValue({
      id: 'p1',
      name: 'SP',
      stock: 500,
      isActive: true,
    });
    repo.findItem.mockResolvedValue({ quantity: 98 } as never);
    await expect(service.addItem('u1', 'p1', 2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sản phẩm ngừng bán / không tồn tại → 404', async () => {
    repo.findProduct.mockResolvedValue(null);
    await expect(service.addItem('u1', 'p1', 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sửa / xoá sản phẩm không có trong giỏ → 404', async () => {
    await expect(service.updateItem('u1', 'p1', 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    repo.removeItem.mockResolvedValue(0);
    await expect(service.removeItem('u1', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
