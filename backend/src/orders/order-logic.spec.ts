import { OrderStatus } from '@prisma/client';
import { canTransition, ORDER_TRANSITIONS } from './order-state-machine';
import { generateOrderCode } from './orders.service';
import { calculateOrderTotals } from './pricing';

describe('Máy trạng thái đơn hàng', () => {
  it.each([
    [OrderStatus.PENDING, OrderStatus.CONFIRMED],
    [OrderStatus.PENDING, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED, OrderStatus.PACKING],
    [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.PACKING, OrderStatus.SHIPPING],
    [OrderStatus.SHIPPING, OrderStatus.DELIVERED],
  ])('cho phép %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [OrderStatus.PENDING, OrderStatus.SHIPPING], // bỏ qua bước
    [OrderStatus.PACKING, OrderStatus.CANCELLED], // hàng đã rời kệ
    [OrderStatus.SHIPPING, OrderStatus.PENDING], // quay ngược
    [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.CANCELLED, OrderStatus.CONFIRMED],
    [OrderStatus.PENDING, OrderStatus.PENDING],
  ])('chặn %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('DELIVERED và CANCELLED là trạng thái cuối', () => {
    expect(ORDER_TRANSITIONS[OrderStatus.DELIVERED]).toEqual([]);
    expect(ORDER_TRANSITIONS[OrderStatus.CANCELLED]).toEqual([]);
  });
});

describe('calculateOrderTotals', () => {
  const lines = [
    { unitPrice: 100_000, quantity: 2 },
    { unitPrice: 55_500, quantity: 1 },
  ];

  it('không có khuyến mãi', () => {
    expect(calculateOrderTotals(lines)).toEqual({
      subtotal: 255_500,
      discount: 0,
      total: 255_500,
    });
  });

  it('giảm theo %, làm tròn xuống tới đồng', () => {
    expect(
      calculateOrderTotals(lines, { discountPercent: 15, maxDiscount: null }),
    ).toEqual({ subtotal: 255_500, discount: 38_325, total: 217_175 });

    expect(
      calculateOrderTotals([{ unitPrice: 999, quantity: 1 }], {
        discountPercent: 10,
        maxDiscount: null,
      }).discount,
    ).toBe(99);
  });

  it('không giảm quá maxDiscount', () => {
    expect(
      calculateOrderTotals(lines, { discountPercent: 50, maxDiscount: 50_000 }),
    ).toEqual({ subtotal: 255_500, discount: 50_000, total: 205_500 });
  });

  it('giỏ rỗng → 0', () => {
    expect(calculateOrderTotals([])).toEqual({
      subtotal: 0,
      discount: 0,
      total: 0,
    });
  });
});

describe('generateOrderCode', () => {
  it('định dạng SF-<ngày theo giờ Việt Nam>-<8 ký tự hex>', () => {
    // 20:00 UTC ngày 31/10 = 03:00 ngày 01/11 giờ Việt Nam
    const code = generateOrderCode(new Date('2026-10-31T20:00:00Z'));
    expect(code).toMatch(/^SF-20261101-[0-9A-F]{8}$/);
  });

  it('các mã sinh ra khác nhau', () => {
    const codes = new Set(
      Array.from({ length: 100 }, () => generateOrderCode()),
    );
    expect(codes.size).toBe(100);
  });
});
