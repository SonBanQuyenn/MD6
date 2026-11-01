# ShopFast

Nền tảng thương mại điện tử (backend NestJS + frontend React) — đồ án Module 06.

> **Trạng thái:** Phase 3 — sản phẩm, giỏ hàng, đơn hàng, tồn kho. Lộ trình: [docs/development-roadmap.md](docs/development-roadmap.md)

| Thành phần | Công nghệ |
|---|---|
| Backend | NestJS 10, TypeScript, Prisma 5 |
| Database / Cache / Queue | PostgreSQL 16, Redis 7 |
| Frontend | React 18, Vite 5, Mantine 7, TanStack Query |
| Hạ tầng | Docker Compose, GitHub Actions, (sắp tới) Nginx + AWS EC2 |

## Yêu cầu cài đặt

- **Node.js 20 LTS** (xem `.nvmrc`; Windows nên dùng [nvm-windows](https://github.com/coreybutler/nvm-windows))
- **Docker Desktop** (đang chạy)
- Git

## Chạy cục bộ

```bash
# 1. Biến môi trường (chỉ dùng cho dev, file .env không được commit)
cp .env.example .env

# 2. Dựng PostgreSQL, Redis, Mailpit
docker compose up -d --wait

# 3. Backend — http://localhost:3000/api
cd backend
npm install
npx prisma generate
npx prisma migrate dev        # tạo bảng trong database
npx prisma db seed            # 4 tài khoản mẫu + 10 danh mục, 21 thương hiệu, 500 sản phẩm
npm run start:dev

# 4. Frontend — http://localhost:5173 (terminal khác)
cd frontend
npm install
npm run dev
```

Mở http://localhost:5173 → thẻ **Trạng thái hệ thống** phải hiện PostgreSQL và Redis `up`.

| Địa chỉ | Nội dung |
|---|---|
| http://localhost:5173 | Frontend |
| http://localhost:3000/api/health | Health check (DB + Redis) — `200` hoặc `503` |
| http://localhost:3000/api/health/live | Tiến trình còn sống |
| http://localhost:8025 | Mailpit — hộp thư xem email backend gửi |

### Tài khoản mẫu (chỉ dev/demo)

Mật khẩu của cả 4 tài khoản là giá trị `SEED_PASSWORD` trong `.env`.

| Email | Vai trò |
|---|---|
| `admin@shopfast.local` | ADMIN |
| `support@shopfast.local` | SUPPORT_AGENT |
| `warehouse@shopfast.local` | WAREHOUSE_STAFF |
| `customer@shopfast.local` | CUSTOMER |

### API xác thực

| Method & đường dẫn | Quyền | Mô tả |
|---|---|---|
| `POST /api/auth/register` | Công khai | Đăng ký tài khoản khách hàng (luôn là CUSTOMER) |
| `POST /api/auth/login` | Công khai | Trả `accessToken` (15 phút) + đặt cookie `sf_refresh` (httpOnly, 7 ngày) |
| `POST /api/auth/refresh` | Cookie `sf_refresh` | Đổi refresh token cũ lấy cặp token mới (xoay vòng) |
| `POST /api/auth/logout` | Cookie `sf_refresh` | Thu hồi refresh token, xoá cookie |
| `GET /api/users/me` | Đã đăng nhập | Thông tin tài khoản hiện tại |
| `GET /api/users` | ADMIN | Danh sách người dùng, `?page&limit&role` |
| `PATCH /api/users/:id/role` | ADMIN | Đổi vai trò |
| `PATCH /api/users/:id/status` | ADMIN | Khoá / mở khoá tài khoản |

Gửi access token qua header: `Authorization: Bearer <accessToken>`.

### API sản phẩm

| Method & đường dẫn | Quyền | Mô tả |
|---|---|---|
| `GET /api/products` | Công khai | Lọc `categoryId`, `brandId`, `minPrice`, `maxPrice`, `q`; `sort` = `newest` \| `price_asc` \| `price_desc` \| `name_asc`; `page`, `limit` (≤ 50) |
| `GET /api/products/:id` | Công khai | Chi tiết sản phẩm (kèm danh mục, thương hiệu) |
| `POST /api/products` | ADMIN | Tạo sản phẩm (kèm tồn kho ban đầu) |
| `PATCH /api/products/:id` | ADMIN | Sửa tên, giá, mô tả… (không sửa tồn kho trực tiếp) |
| `DELETE /api/products/:id` | ADMIN | Ngừng bán (giữ lại dữ liệu cho đơn hàng cũ) |
| `GET /api/categories`, `GET /api/brands` | Công khai | Danh sách (kèm số sản phẩm đang bán) |
| `POST/PATCH/DELETE /api/categories/:id`, `/api/brands/:id` | ADMIN | Quản lý; không xoá được khi còn sản phẩm (409) |

### API giỏ hàng, đơn hàng, tồn kho

| Method & đường dẫn | Quyền | Mô tả |
|---|---|---|
| `GET /api/cart` | CUSTOMER | Giỏ hàng theo giá hiện tại, cảnh báo hết hàng / ngừng bán |
| `POST /api/cart/items` · `PATCH/DELETE /api/cart/items/:productId` · `DELETE /api/cart` | CUSTOMER | Thêm (cộng dồn), sửa số lượng, xoá |
| `POST /api/orders` | CUSTOMER | Đặt đơn từ giỏ. **Bắt buộc header `Idempotency-Key`** (8–100 ký tự); gửi lại cùng key → trả đơn cũ (200, header `Idempotent-Replayed: true`) |
| `POST /api/orders/promotional` | CUSTOMER | Như trên + `promotionCode` |
| `GET /api/orders/me` | CUSTOMER | Lịch sử đơn, `?status&page&limit` |
| `GET /api/orders/:id` | Chủ đơn hoặc nhân viên | Chi tiết + dòng thời gian trạng thái |
| `POST /api/orders/:id/cancel` | CUSTOMER | Huỷ đơn đang chờ xác nhận (hoàn kho) |
| `POST /api/orders/:id/pay` | CUSTOMER | Thanh toán **giả lập** cho `MOCK_ONLINE` |
| `GET /api/orders` | SUPPORT_AGENT, WAREHOUSE_STAFF, ADMIN | Mọi đơn hàng |
| `PATCH /api/orders/:id/status` | WAREHOUSE_STAFF, ADMIN | `PENDING → CONFIRMED → PACKING → SHIPPING → DELIVERED`, huỷ khi `PENDING/CONFIRMED` |
| `POST /api/inventory/adjustments` | WAREHOUSE_STAFF, ADMIN | Nhập (`delta > 0`) / xuất (`delta < 0`) kho |
| `GET /api/inventory/low-stock` · `GET /api/inventory/products/:id/movements` | WAREHOUSE_STAFF, ADMIN | Sắp hết hàng · lịch sử biến động |
| `GET/POST /api/promotions` | ADMIN | Quản lý mã khuyến mãi |

Dừng hạ tầng: `docker compose down` (thêm `-v` để **xoá luôn dữ liệu**).

## Lệnh thường dùng

| Lệnh (trong `backend/` hoặc `frontend/`) | Tác dụng |
|---|---|
| `npm run lint` | Kiểm tra lỗi code (ESLint) |
| `npm run format` / `npm run format:check` | Định dạng code / kiểm tra định dạng (Prettier) |
| `npm test` | Unit test (backend) |
| `npm run test:cov` | Unit test + báo cáo độ phủ → `backend/coverage/` |
| `npm run test:e2e` | Integration test — **cần `docker compose up` trước**. Chạy trên database riêng `shopfast_test` (tự tạo + migrate) và Redis DB 1, không đụng dữ liệu dev |
| `npm run build` | Build production |

## Cấu trúc thư mục

```
backend/     NestJS API (src/, prisma/, test/)
frontend/    React + Vite
docs/        Tài liệu yêu cầu, kiến trúc, CSDL, quyết định kỹ thuật
.github/     GitHub Actions CI
```

## Quy trình Git

- `main` — bản ổn định, phát hành; `develop` — nhánh tích hợp; `feature/*` — từng tính năng.
- Mọi thay đổi vào `develop`/`main` đi qua **Pull Request**, CI phải xanh mới được merge.
- Commit theo [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `build:`, `chore:`…

## Tài liệu

- [Phân tích yêu cầu](docs/requirements.md) · [Ma trận truy vết](docs/requirements-traceability-matrix.md)
- [Kiến trúc](docs/architecture.md) · [Thiết kế CSDL](docs/database-design.md)
- [Quyết định kỹ thuật](docs/technical-decisions.md) · [Lộ trình](docs/development-roadmap.md)
