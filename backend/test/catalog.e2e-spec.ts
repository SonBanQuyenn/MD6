import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

describe('Catalog (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  let adminToken: string;
  let customerToken: string;
  let laptopId: string;
  let phoneId: string;
  let dellId: string;
  let appleId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const admin = await createUser(prisma, Role.ADMIN, 'admin@example.com');
    const customer = await createUser(
      prisma,
      Role.CUSTOMER,
      'customer@example.com',
    );
    adminToken = (await loginAs(app, admin.email)).accessToken;
    customerToken = (await loginAs(app, customer.email)).accessToken;

    laptopId = (
      await prisma.category.create({ data: { name: 'Laptop', slug: 'laptop' } })
    ).id;
    phoneId = (
      await prisma.category.create({
        data: { name: 'Điện thoại', slug: 'dien-thoai' },
      })
    ).id;
    dellId = (
      await prisma.brand.create({ data: { name: 'Dell', slug: 'dell' } })
    ).id;
    appleId = (
      await prisma.brand.create({ data: { name: 'Apple', slug: 'apple' } })
    ).id;

    // 6 sản phẩm: 1 sản phẩm ngừng bán không được xuất hiện ở API công khai
    const rows = [
      ['LT-1', 'Laptop Dell A', 10_000_000, laptopId, dellId, true],
      ['LT-2', 'Laptop Dell B', 20_000_000, laptopId, dellId, true],
      ['LT-3', 'MacBook Air', 30_000_000, laptopId, appleId, true],
      ['DT-1', 'iPhone 15', 25_000_000, phoneId, appleId, true],
      ['DT-2', 'iPhone 14', 15_000_000, phoneId, appleId, true],
      ['DT-3', 'iPhone Cũ', 5_000_000, phoneId, appleId, false],
    ] as const;
    for (const [sku, name, price, categoryId, brandId, isActive] of rows) {
      await prisma.product.create({
        data: {
          sku,
          name,
          slug: sku.toLowerCase(),
          price,
          stock: 10,
          categoryId,
          brandId,
          isActive,
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const list = (query: string) =>
    http().get(`/api/products?${query}`).expect(200);
  const skus = (res: request.Response) =>
    res.body.items.map((p: { sku: string }) => p.sku);

  describe('GET /api/products (công khai)', () => {
    it('không cần đăng nhập; ẩn sản phẩm ngừng bán', async () => {
      const res = await list('');
      expect(res.body.total).toBe(5);
      expect(skus(res)).not.toContain('DT-3');
    });

    it('lọc theo danh mục', async () => {
      const res = await list(`categoryId=${laptopId}&sort=price_asc`);
      expect(skus(res)).toEqual(['LT-1', 'LT-2', 'LT-3']);
    });

    it('lọc theo thương hiệu + danh mục', async () => {
      const res = await list(`categoryId=${laptopId}&brandId=${appleId}`);
      expect(skus(res)).toEqual(['LT-3']);
    });

    it('lọc theo khoảng giá (bao gồm 2 đầu mút)', async () => {
      const res = await list(
        'minPrice=15000000&maxPrice=25000000&sort=price_asc',
      );
      expect(skus(res)).toEqual(['DT-2', 'LT-2', 'DT-1']);
    });

    it('tìm theo tên không phân biệt hoa thường', async () => {
      const res = await list('q=IPHONE&sort=price_desc');
      expect(skus(res)).toEqual(['DT-1', 'DT-2']);
    });

    it('phân trang: trang 2 với limit 2, sắp xếp giá giảm dần', async () => {
      const res = await list('page=2&limit=2&sort=price_desc');
      expect(res.body).toMatchObject({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
      expect(skus(res)).toEqual(['LT-2', 'DT-2']);
    });

    it('tham số không hợp lệ → 400', async () => {
      await http().get('/api/products?minPrice=-1').expect(400);
      await http().get('/api/products?limit=1000').expect(400);
      await http().get('/api/products?categoryId=abc').expect(400);
      await http().get('/api/products?sort=random').expect(400);
      await http().get('/api/products?minPrice=10&maxPrice=5').expect(400);
    });
  });

  describe('GET /api/products/:id', () => {
    it('trả chi tiết kèm danh mục và thương hiệu', async () => {
      const p = await prisma.product.findUniqueOrThrow({
        where: { sku: 'LT-3' },
      });
      const res = await http().get(`/api/products/${p.id}`).expect(200);
      expect(res.body).toMatchObject({
        sku: 'LT-3',
        inStock: true,
        category: { slug: 'laptop' },
        brand: { slug: 'apple' },
      });
    });

    it('sản phẩm ngừng bán → 404; id sai định dạng → 400', async () => {
      const hidden = await prisma.product.findUniqueOrThrow({
        where: { sku: 'DT-3' },
      });
      await http().get(`/api/products/${hidden.id}`).expect(404);
      await http().get('/api/products/khong-phai-uuid').expect(400);
    });
  });

  describe('Quản trị sản phẩm (ADMIN)', () => {
    const newProduct = () => ({
      sku: 'lt-new-1',
      name: 'Laptop Dell Mới',
      price: 12_000_000,
      stock: 3,
      categoryId: laptopId,
      brandId: dellId,
    });

    it('CUSTOMER tạo sản phẩm → 403; chưa đăng nhập → 401', async () => {
      await http()
        .post('/api/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(newProduct())
        .expect(403);
      await http().post('/api/products').send(newProduct()).expect(401);
    });

    it('ADMIN tạo sản phẩm → 201, SKU viết hoa, slug tự sinh; tạo trùng SKU → 409', async () => {
      const res = await http()
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newProduct())
        .expect(201);
      expect(res.body).toMatchObject({
        sku: 'LT-NEW-1',
        slug: 'laptop-dell-moi-lt-new-1',
        stock: 3,
      });

      await http()
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newProduct())
        .expect(409);
    });

    it('PATCH không cho sửa tồn kho trực tiếp (400); đổi giá → version tăng', async () => {
      const p = await prisma.product.findUniqueOrThrow({
        where: { sku: 'LT-1' },
      });

      await http()
        .patch(`/api/products/${p.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stock: 999 })
        .expect(400);

      const res = await http()
        .patch(`/api/products/${p.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 9_500_000 })
        .expect(200);
      expect(res.body.price).toBe(9_500_000);

      const updated = await prisma.product.findUniqueOrThrow({
        where: { id: p.id },
      });
      expect(updated.version).toBe(p.version + 1);
    });

    it('DELETE = ngừng bán: sản phẩm biến mất khỏi API công khai nhưng vẫn còn trong DB', async () => {
      const p = await prisma.product.findUniqueOrThrow({
        where: { sku: 'LT-1' },
      });

      await http()
        .delete(`/api/products/${p.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await http().get(`/api/products/${p.id}`).expect(404);
      expect(
        await prisma.product.findUnique({ where: { id: p.id } }),
      ).not.toBeNull();
    });

    it('DB chặn tồn kho âm bằng CHECK constraint (lớp bảo vệ cuối)', async () => {
      await expect(
        prisma.product.update({
          where: { sku: 'LT-1' },
          data: { stock: -1 },
        }),
      ).rejects.toThrow(/products_stock_non_negative/);
    });
  });

  describe('Danh mục & thương hiệu', () => {
    it('GET /api/categories công khai, có số sản phẩm đang bán', async () => {
      const res = await http().get('/api/categories').expect(200);
      const phone = res.body.find(
        (c: { slug: string }) => c.slug === 'dien-thoai',
      );
      expect(phone.productCount).toBe(2); // DT-3 ngừng bán không được đếm
    });

    it('ADMIN tạo danh mục, slug tự sinh từ tên tiếng Việt', async () => {
      const res = await http()
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Đồng hồ thông minh' })
        .expect(201);
      expect(res.body.slug).toBe('dong-ho-thong-minh');
    });

    it('không xoá được danh mục / thương hiệu còn sản phẩm → 409', async () => {
      await http()
        .delete(`/api/categories/${laptopId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
      await http()
        .delete(`/api/brands/${dellId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('xoá danh mục rỗng → 204; xoá lần nữa → 404', async () => {
      const empty = await prisma.category.create({
        data: { name: 'Rỗng', slug: 'rong' },
      });
      await http()
        .delete(`/api/categories/${empty.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
      await http()
        .delete(`/api/categories/${empty.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
