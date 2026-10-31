/**
 * Seed dữ liệu mẫu cho môi trường DEV/DEMO (SRS: "dữ liệu ban đầu nạp sẵn bằng script seed").
 * Chạy: npx prisma db seed
 *
 * Chạy lại nhiều lần vẫn an toàn (upsert / skipDuplicates) và luôn ra cùng một dữ liệu
 * (dùng bộ sinh số giả ngẫu nhiên có seed cố định).
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ACCOUNTS: { email: string; fullName: string; role: Role }[] = [
  {
    email: 'admin@shopfast.local',
    fullName: 'Quản trị viên',
    role: Role.ADMIN,
  },
  {
    email: 'support@shopfast.local',
    fullName: 'Nhân viên CSKH',
    role: Role.SUPPORT_AGENT,
  },
  {
    email: 'warehouse@shopfast.local',
    fullName: 'Nhân viên kho',
    role: Role.WAREHOUSE_STAFF,
  },
  {
    email: 'customer@shopfast.local',
    fullName: 'Nguyễn Văn Khách',
    role: Role.CUSTOMER,
  },
];

interface CategorySeed {
  code: string;
  name: string;
  slug: string;
  noun: string;
  /** Khoảng giá, đơn vị nghìn đồng */
  priceK: [number, number];
  brands: string[];
}

const CATEGORIES: CategorySeed[] = [
  {
    code: 'DT',
    name: 'Điện thoại',
    slug: 'dien-thoai',
    noun: 'Điện thoại',
    priceK: [2_000, 35_000],
    brands: ['Apple', 'Samsung', 'Xiaomi', 'OPPO'],
  },
  {
    code: 'LT',
    name: 'Laptop',
    slug: 'laptop',
    noun: 'Laptop',
    priceK: [10_000, 60_000],
    brands: ['Apple', 'Dell', 'ASUS', 'Lenovo', 'HP'],
  },
  {
    code: 'TB',
    name: 'Máy tính bảng',
    slug: 'may-tinh-bang',
    noun: 'Máy tính bảng',
    priceK: [5_000, 30_000],
    brands: ['Apple', 'Samsung', 'Xiaomi', 'Lenovo'],
  },
  {
    code: 'TN',
    name: 'Tai nghe',
    slug: 'tai-nghe',
    noun: 'Tai nghe',
    priceK: [300, 8_000],
    brands: ['Sony', 'Apple', 'JBL', 'Samsung'],
  },
  {
    code: 'DH',
    name: 'Đồng hồ thông minh',
    slug: 'dong-ho-thong-minh',
    noun: 'Đồng hồ',
    priceK: [1_000, 20_000],
    brands: ['Apple', 'Samsung', 'Xiaomi', 'Garmin'],
  },
  {
    code: 'LO',
    name: 'Loa',
    slug: 'loa',
    noun: 'Loa',
    priceK: [500, 15_000],
    brands: ['JBL', 'Sony', 'Marshall'],
  },
  {
    code: 'PK',
    name: 'Phụ kiện',
    slug: 'phu-kien',
    noun: 'Sạc nhanh',
    priceK: [100, 2_000],
    brands: ['Anker', 'Baseus', 'Ugreen'],
  },
  {
    code: 'MH',
    name: 'Màn hình',
    slug: 'man-hinh',
    noun: 'Màn hình',
    priceK: [2_000, 25_000],
    brands: ['Dell', 'LG', 'Samsung', 'ASUS'],
  },
  {
    code: 'BP',
    name: 'Bàn phím & Chuột',
    slug: 'ban-phim-chuot',
    noun: 'Bàn phím',
    priceK: [200, 5_000],
    brands: ['Logitech', 'Razer', 'Akko'],
  },
  {
    code: 'MA',
    name: 'Máy ảnh',
    slug: 'may-anh',
    noun: 'Máy ảnh',
    priceK: [8_000, 80_000],
    brands: ['Sony', 'Canon', 'Fujifilm'],
  },
];

const SERIES = [
  'Pro',
  'Max',
  'Lite',
  'Plus',
  'Air',
  'X',
  'S',
  'Ultra',
  'Neo',
  'Mini',
];
const PRODUCTS_PER_CATEGORY = 50;

/** Bộ sinh số giả ngẫu nhiên (LCG) có seed cố định → seed lại luôn ra cùng dữ liệu. */
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const toSlug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

async function seedAccounts(password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  for (const account of ACCOUNTS) {
    await prisma.user.upsert({
      where: { email: account.email },
      update: { role: account.role, fullName: account.fullName },
      create: { ...account, passwordHash, emailVerified: true },
    });
  }
  console.log(`✔ ${ACCOUNTS.length} tài khoản mẫu`);
}

async function seedCatalog() {
  const brandNames = [...new Set(CATEGORIES.flatMap((c) => c.brands))];
  const brandIds = new Map<string, string>();
  for (const name of brandNames) {
    const slug = toSlug(name);
    const brand = await prisma.brand.upsert({
      where: { slug },
      update: {},
      create: { name, slug },
    });
    brandIds.set(name, brand.id);
  }

  const random = createRandom(2026);
  const products = [];
  for (const category of CATEGORIES) {
    const { id: categoryId } = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: { name: category.name, slug: category.slug },
    });

    for (let i = 1; i <= PRODUCTS_PER_CATEGORY; i++) {
      const brand = category.brands[i % category.brands.length];
      const series = SERIES[Math.floor(random() * SERIES.length)];
      const name = `${category.noun} ${brand} ${series} ${10 + i}`;
      const sku = `${category.code}-${toSlug(brand).slice(0, 3).toUpperCase()}-${String(i).padStart(4, '0')}`;
      const [minK, maxK] = category.priceK;
      // Giá làm tròn tới 10.000đ cho giống thực tế, ví dụ 12.490.000đ
      const price =
        Math.round((minK + random() * (maxK - minK)) / 10) * 10_000 - 10_000;
      // ~8% sản phẩm hết hàng để demo trạng thái "Hết hàng"
      const stock = random() < 0.08 ? 0 : Math.floor(random() * 200) + 1;

      products.push({
        sku,
        name,
        slug: `${toSlug(name)}-${sku.toLowerCase()}`,
        description: `${name} chính hãng ${brand}, bảo hành 12 tháng.`,
        price: Math.max(price, 0),
        stock,
        categoryId,
        brandId: brandIds.get(brand)!,
      });
    }
  }

  const { count } = await prisma.product.createMany({
    data: products,
    skipDuplicates: true, // SKU đã có → bỏ qua
  });
  console.log(
    `✔ ${CATEGORIES.length} danh mục, ${brandNames.length} thương hiệu, ` +
      `${products.length} sản phẩm (${count} mới)`,
  );
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không chạy seed dữ liệu mẫu trên production.');
  }
  const password = process.env.SEED_PASSWORD;
  if (!password) {
    throw new Error('Thiếu biến môi trường SEED_PASSWORD (xem .env.example).');
  }
  await seedAccounts(password);
  await seedCatalog();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
