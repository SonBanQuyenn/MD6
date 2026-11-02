# ShopFast

Nền tảng thương mại điện tử (backend NestJS + frontend React) — đồ án Module 06.

> **Trạng thái:** Phase 7 — cache Redis (đã xong cả tác vụ nền Phase 8). Lộ trình: [docs/development-roadmap.md](docs/development-roadmap.md)

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

# 4. Worker xử lý job nền — email, hoá đơn, đồng bộ kho, báo cáo (terminal khác)
cd backend
npm run start:worker:dev

# 5. Frontend — http://localhost:5173 (terminal khác)
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
| http://localhost:8025 | Mailpit — hộp thư xem email backend gửi (xác nhận đơn, nhắc thanh toán, báo cáo) |

### Tài khoản mẫu (chỉ dev/demo)

Mật khẩu của cả 4 tài khoản là giá trị `SEED_PASSWORD` trong `.env`.

| Email | Vai trò |
|---|---|
| `admin@shopfast.local` | ADMIN |
| `support@shopfast.local` | SUPPORT_AGENT |
| `warehouse@shopfast.local` | WAREHOUSE_STAFF |
| `customer@shopfast.local` | CUSTOMER |

### Tài liệu

| Nhóm | Tài liệu |
|---|---|
| Yêu cầu | [Phân tích yêu cầu](docs/requirements.md) · [Ma trận truy vết](docs/requirements-traceability-matrix.md) · [Lộ trình](docs/development-roadmap.md) |
| Thiết kế | [Kiến trúc](docs/architecture.md) · [Thiết kế CSDL](docs/database-design.md) · [Quyết định kỹ thuật](docs/technical-decisions.md) · [Tài liệu API](docs/api-documentation.md) (+ Swagger `/api/docs`) |
| Kiểm chứng | [Kiểm thử & độ phủ](docs/testing-report.md) · [Hiệu năng](docs/performance-report.md) · [Bảo mật](docs/security-report.md) · [Sao lưu & khôi phục](docs/backup-recovery-report.md) |
| Vận hành | [Hướng dẫn triển khai](docs/deployment-guide.md) · [Sao lưu](infra/backup/README.md) |
| Bảo vệ | [Các chủ đề đã tích hợp (D05)](docs/integration-summary.md) · [Kịch bản demo](docs/demo-script.md) · [Câu hỏi bảo vệ](docs/defense-questions.md) |
