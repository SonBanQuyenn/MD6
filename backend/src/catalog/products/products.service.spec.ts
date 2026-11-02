import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../../cache/cache.service';
import { CatalogCacheInvalidator } from '../../cache/catalog-cache';
import { BrandsRepository } from '../brands/brands.repository';
import { CategoriesRepository } from '../categories/categories.repository';
import { ProductSort } from './dto/list-products-query.dto';
import {
  buildWhere,
  ProductsRepository,
  ProductWithRelations,
} from './products.repository';
import { ProductsService } from './products.service';

const product = (
  overrides: Partial<ProductWithRelations> = {},
): ProductWithRelations => ({
  id: 'p1',
  sku: 'LT-DEL-0001',
  name: 'Laptop Dell X 11',
  slug: 'laptop-dell-x-11-lt-del-0001',
  description: '',
  price: 20_000_000,
  stock: 5,
  imageUrl: null,
  isActive: true,
  version: 1,
  categoryId: 'c1',
  brandId: 'b1',
  createdAt: new Date(),
  updatedAt: new Date(),
  category: { id: 'c1', name: 'Laptop', slug: 'laptop' },
  brand: { id: 'b1', name: 'Dell', slug: 'dell' },
  ...overrides,
});

describe('buildWhere (bộ lọc sản phẩm)', () => {
  it('không có bộ lọc → chỉ lọc sản phẩm đang bán', () => {
    expect(buildWhere({ onlyActive: true })).toEqual({ isActive: true });
  });

  it('kết hợp đủ danh mục, thương hiệu, khoảng giá và từ khoá', () => {
    expect(
      buildWhere({
        onlyActive: true,
        categoryId: 'c1',
        brandId: 'b1',
        minPrice: 1_000,
        maxPrice: 5_000,
        q: 'dell',
      }),
    ).toEqual({
      isActive: true,
      categoryId: 'c1',
      brandId: 'b1',
      price: { gte: 1_000, lte: 5_000 },
      name: { contains: 'dell', mode: 'insensitive' },
    });
  });

  it('chỉ có minPrice → lte để undefined (Prisma bỏ qua)', () => {
    expect(buildWhere({ onlyActive: false, minPrice: 0 })).toEqual({
      price: { gte: 0, lte: undefined },
    });
  });
});

describe('ProductsService', () => {
  let products: jest.Mocked<
    Pick<
      ProductsRepository,
      'findMany' | 'findById' | 'create' | 'update' | 'findManyByIds'
    >
  >;
  let categories: jest.Mocked<Pick<CategoriesRepository, 'findById'>>;
  let brands: jest.Mocked<Pick<BrandsRepository, 'findById'>>;
  let service: ProductsService;
  let invalidator: {
    invalidateProducts: jest.Mock;
    invalidateLists: jest.Mock;
  };

  /** Cache "đi thẳng": luôn MISS, gọi loader — để test logic nghiệp vụ, không test cache. */
  const passThroughCache = {
    getOrLoad: jest.fn(
      async (_key: string, loader: () => Promise<unknown>) => ({
        value: await loader(),
        status: 'MISS',
      }),
    ),
    getNumber: jest.fn().mockResolvedValue(0),
    getMany: jest.fn(async (keys: string[]) => keys.map(() => undefined)),
    setMany: jest.fn(),
  };

  beforeEach(() => {
    invalidator = { invalidateProducts: jest.fn(), invalidateLists: jest.fn() };
    products = {
      findMany: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findManyByIds: jest.fn().mockResolvedValue([product()]),
    };
    categories = { findById: jest.fn().mockResolvedValue({ id: 'c1' }) };
    brands = { findById: jest.fn().mockResolvedValue({ id: 'b1' }) };
    service = new ProductsService(
      products as unknown as ProductsRepository,
      categories as unknown as CategoriesRepository,
      brands as unknown as BrandsRepository,
      passThroughCache as unknown as CacheService,
      invalidator as unknown as CatalogCacheInvalidator,
    );
  });

  describe('list', () => {
    it('tính skip từ page/limit và chỉ lấy sản phẩm đang bán', async () => {
      products.findMany.mockResolvedValue({ items: [product()], total: 41 });

      const result = await service.list({
        page: 3,
        limit: 20,
        sort: ProductSort.PRICE_ASC,
        brandId: 'b1',
      });

      expect(products.findMany).toHaveBeenCalledWith(
        { brandId: 'b1', onlyActive: true },
        { skip: 40, take: 20, sort: ProductSort.PRICE_ASC },
      );
      expect(result).toMatchObject({ total: 41, totalPages: 3, page: 3 });
      expect(result.items[0].inStock).toBe(true);
    });

    it('minPrice > maxPrice → 400', async () => {
      await expect(
        service.list({
          page: 1,
          limit: 20,
          sort: ProductSort.NEWEST,
          minPrice: 10,
          maxPrice: 5,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(products.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getPublic', () => {
    it('sản phẩm ngừng bán → 404', async () => {
      products.findById.mockResolvedValue(product({ isActive: false }));
      await expect(service.getPublic('p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('sản phẩm hết hàng vẫn hiển thị, inStock = false', async () => {
      products.findById.mockResolvedValue(product({ stock: 0 }));
      await expect(service.getPublic('p1')).resolves.toMatchObject({
        inStock: false,
      });
    });
  });

  describe('create', () => {
    const dto = {
      sku: 'LT-DEL-0099',
      name: 'Laptop Dell Mới',
      price: 1_000,
      categoryId: 'c1',
      brandId: 'b1',
    };

    it('sinh slug từ tên + SKU', async () => {
      products.create.mockResolvedValue(product());

      await service.create(dto);

      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'laptop-dell-moi-lt-del-0099' }),
      );
    });

    it('danh mục không tồn tại → 400', async () => {
      categories.findById.mockResolvedValue(null);
      await expect(service.create(dto)).rejects.toThrow(
        'Danh mục không tồn tại',
      );
    });

    it('SKU trùng → 409', async () => {
      products.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('đổi giá → làm mới cache chi tiết + danh sách NGAY (khách không thấy giá cũ)', async () => {
      products.findById.mockResolvedValue(product());
      products.update.mockResolvedValue(product({ price: 19_000_000 }));

      await service.update('p1', { price: 19_000_000 });

      expect(invalidator.invalidateProducts).toHaveBeenCalledWith(['p1']);
      expect(invalidator.invalidateLists).toHaveBeenCalled();
    });

    it('đổi giá → tăng version của sản phẩm', async () => {
      products.findById.mockResolvedValue(product());
      products.update.mockResolvedValue(product({ price: 19_000_000 }));

      await service.update('p1', { price: 19_000_000 });

      expect(products.update).toHaveBeenCalledWith('p1', {
        price: 19_000_000,
        version: { increment: 1 },
      });
    });

    it('giá không đổi → không tăng version', async () => {
      products.findById.mockResolvedValue(product());
      products.update.mockResolvedValue(product());

      await service.update('p1', { price: 20_000_000 });

      expect(products.update).toHaveBeenCalledWith('p1', {
        price: 20_000_000,
      });
    });

    it('đổi tên → cập nhật slug, giữ nguyên SKU', async () => {
      products.findById.mockResolvedValue(product());
      products.update.mockResolvedValue(product());

      await service.update('p1', { name: 'Laptop Dell Đời Mới' });

      expect(products.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          slug: 'laptop-dell-doi-moi-lt-del-0001',
        }),
      );
    });

    it('sản phẩm không tồn tại → 404', async () => {
      products.findById.mockResolvedValue(null);
      await expect(service.update('x', { price: 1 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('deactivate: ngừng bán + tăng version', async () => {
    products.findById.mockResolvedValue(product());
    products.update.mockResolvedValue(product({ isActive: false }));

    await service.deactivate('p1');

    expect(products.update).toHaveBeenCalledWith('p1', {
      isActive: false,
      version: { increment: 1 },
    });
  });
});
