import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InventoryReason, Promotion } from '@prisma/client';
import { PromotionsRepository } from '../promotions/promotions.repository';
import { PromotionsService } from '../promotions/promotions.service';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

describe('InventoryService.adjust', () => {
  const repo = { adjust: jest.fn() };
  const service = new InventoryService(repo as unknown as InventoryRepository);

  beforeEach(() => repo.adjust.mockReset());

  it('ghi nhận là MANUAL_ADJUST kèm người thực hiện', async () => {
    repo.adjust.mockResolvedValue({
      ok: true,
      product: { id: 'p1', sku: 'S', name: 'SP', stock: 15 },
      movement: { id: 'm1' },
    });

    const result = await service.adjust('w1', { productId: 'p1', delta: 5 });

    expect(repo.adjust).toHaveBeenCalledWith({
      productId: 'p1',
      delta: 5,
      reason: InventoryReason.MANUAL_ADJUST,
      actorId: 'w1',
    });
    expect(result.product.stock).toBe(15);
  });

  it('xuất quá tồn kho → 409 kèm số còn lại', async () => {
    repo.adjust.mockResolvedValue({
      ok: false,
      reason: 'INSUFFICIENT',
      available: 3,
    });
    await expect(
      service.adjust('w1', { productId: 'p1', delta: -5 }),
    ).rejects.toThrow('hiện chỉ còn 3 sản phẩm');
  });

  it('sản phẩm không tồn tại → 404', async () => {
    repo.adjust.mockResolvedValue({
      ok: false,
      reason: 'NOT_FOUND',
      available: 0,
    });
    await expect(
      service.adjust('w1', { productId: 'p1', delta: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PromotionsService.getUsable', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const promo = (overrides: Partial<Promotion> = {}): Promotion => ({
    id: 'pr1',
    code: 'GIAM10',
    description: '',
    discountPercent: 10,
    maxDiscount: null,
    maxUses: 100,
    usedCount: 0,
    perUserLimit: 1,
    startsAt: new Date('2026-11-01T00:00:00Z'),
    endsAt: new Date('2026-11-30T00:00:00Z'),
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  });
  const repo = { findByCode: jest.fn() };
  const service = new PromotionsService(
    repo as unknown as PromotionsRepository,
  );

  it('mã hợp lệ (không phân biệt hoa thường)', async () => {
    repo.findByCode.mockResolvedValue(promo());
    await expect(service.getUsable(' giam10 ', now)).resolves.toMatchObject({
      code: 'GIAM10',
    });
    expect(repo.findByCode).toHaveBeenCalledWith('GIAM10');
  });

  it.each([
    ['không tồn tại', null, NotFoundException],
    ['đã tắt', promo({ isActive: false }), NotFoundException],
    [
      'chưa bắt đầu',
      promo({ startsAt: new Date('2026-12-01') }),
      BadRequestException,
    ],
    [
      'đã hết hạn',
      promo({ endsAt: new Date('2026-10-01') }),
      BadRequestException,
    ],
    ['hết lượt', promo({ usedCount: 100 }), ConflictException],
  ])('mã %s → lỗi', async (_label, value, ErrorType) => {
    repo.findByCode.mockResolvedValue(value);
    await expect(service.getUsable('GIAM10', now)).rejects.toBeInstanceOf(
      ErrorType,
    );
  });
});
