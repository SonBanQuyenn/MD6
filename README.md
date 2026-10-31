# ShopFast

Nền tảng thương mại điện tử (backend NestJS + frontend React) — đồ án Module 06.

> **Trạng thái:** Phase 1 — khởi tạo dự án. Lộ trình: [docs/development-roadmap.md](docs/development-roadmap.md)

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

Dừng hạ tầng: `docker compose down` (thêm `-v` để **xoá luôn dữ liệu**).

## Lệnh thường dùng

| Lệnh (trong `backend/` hoặc `frontend/`) | Tác dụng |
|---|---|
| `npm run lint` | Kiểm tra lỗi code (ESLint) |
| `npm run format` / `npm run format:check` | Định dạng code / kiểm tra định dạng (Prettier) |
| `npm test` | Unit test (backend) |
| `npm run test:cov` | Unit test + báo cáo độ phủ → `backend/coverage/` |
| `npm run test:e2e` | Integration test — **cần `docker compose up` trước** |
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
