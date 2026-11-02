import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { CatalogCacheInvalidator } from '../cache/catalog-cache';
import { BrandsRepository } from './brands/brands.repository';
import { BrandsService } from './brands/brands.service';
import { CategoriesRepository } from './categories/categories.repository';
import { CategoriesService } from './categories/categories.service';
import { ProductsRepository } from './products/products.repository';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('db error', {
    code,
    clientVersion: '5.22.0',
  });

/**
 * Danh mục và thương hiệu có cùng nghiệp vụ (CRUD + làm mới cache), nên chạy cùng một bộ test
 * cho cả hai service.
 */
describe.each([
  {
    name: 'CategoriesService',
    make: (repo: unknown, products: unknown, cache: unknown, inv: unknown) =>
      new CategoriesService(
        repo as CategoriesRepository,
        products as ProductsRepository,
        cache as CacheService,
        inv as CatalogCacheInvalidator,
      ),
    taxonomyKey: 'categoryId',
  },
  {
    name: 'BrandsService',
    make: (repo: unknown, products: unknown, cache: unknown, inv: unknown) =>
      new BrandsService(
        repo as BrandsRepository,
        products as ProductsRepository,
        cache as CacheService,
        inv as CatalogCacheInvalidator,
      ),
    taxonomyKey: 'brandId',
  },
])('$name', ({ make, taxonomyKey }) => {
  let repo: {
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let products: { findIdsByTaxonomy: jest.Mock };
  let cache: { getNumber: jest.Mock; getOrLoad: jest.Mock };
  let invalidator: {
    invalidateLists: jest.Mock;
    invalidateProducts: jest.Mock;
  };
  let service: CategoriesService | BrandsService;

  beforeEach(() => {
    repo = {
      findAll: jest.fn().mockResolvedValue([{ id: 'x', name: 'A' }]),
      create: jest.fn(async (data) => ({ id: 'new', ...data })),
      update: jest.fn(async (id, data) => ({ id, ...data })),
      delete: jest.fn(),
    };
    products = { findIdsByTaxonomy: jest.fn().mockResolvedValue(['p1', 'p2']) };
    cache = {
      getNumber: jest.fn().mockResolvedValue(3),
      getOrLoad: jest.fn(async (_key, load) => ({ value: await load() })),
    };
    invalidator = {
      invalidateLists: jest.fn(),
      invalidateProducts: jest.fn(),
    };
    service = make(repo, products, cache, invalidator);
  });

  it('list: đọc qua cache theo catalog version', async () => {
    await expect(service.list()).resolves.toEqual([{ id: 'x', name: 'A' }]);
    expect(cache.getOrLoad).toHaveBeenCalledWith(
      expect.stringContaining(':v3'),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('list: Redis lỗi (không đọc được version) → đọc thẳng DB', async () => {
    cache.getNumber.mockResolvedValue(null);
    await service.list();
    expect(cache.getOrLoad).not.toHaveBeenCalled();
    expect(repo.findAll).toHaveBeenCalled();
  });

  it('create: tự sinh slug từ tên tiếng Việt và làm mới cache danh sách', async () => {
    const created = await service.create({ name: 'Tai nghe Không dây' });
    expect(created).toMatchObject({ slug: 'tai-nghe-khong-day' });
    expect(invalidator.invalidateLists).toHaveBeenCalled();
  });

  it('create: trùng slug → 409', async () => {
    repo.create.mockRejectedValue(prismaError('P2002'));
    await expect(service.create({ name: 'A' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('update: làm mới cache của MỌI sản phẩm thuộc nhóm này', async () => {
    await service.update('t1', { name: 'Mới' });
    expect(products.findIdsByTaxonomy).toHaveBeenCalledWith({
      [taxonomyKey]: 't1',
    });
    expect(invalidator.invalidateProducts).toHaveBeenCalledWith(['p1', 'p2']);
    expect(invalidator.invalidateLists).toHaveBeenCalled();
  });

  it.each([
    ['P2025', NotFoundException],
    ['P2002', ConflictException],
  ])('update: lỗi %s → %p', async (code, type) => {
    repo.update.mockRejectedValue(prismaError(code));
    await expect(service.update('t1', { name: 'X' })).rejects.toBeInstanceOf(
      type,
    );
  });

  it.each([
    ['P2025', NotFoundException],
    ['P2003', ConflictException],
  ])(
    'remove: lỗi %s → %p (còn sản phẩm thì không xoá được)',
    async (code, type) => {
      repo.delete.mockRejectedValue(prismaError(code));
      await expect(service.remove('t1')).rejects.toBeInstanceOf(type);
    },
  );

  it('remove thành công → làm mới cache danh sách', async () => {
    await service.remove('t1');
    expect(invalidator.invalidateLists).toHaveBeenCalled();
  });

  it('lỗi không xác định → ném nguyên lỗi', async () => {
    repo.delete.mockRejectedValue(new Error('boom'));
    await expect(service.remove('t1')).rejects.toThrow('boom');
  });
});
