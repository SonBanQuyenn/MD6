# Báo cáo kiểm thử — ShopFast

> Mọi số liệu dưới đây là **kết quả chạy thật** ngày 2026-11-02 trên máy phát triển (Windows 11,
> Node 22, PostgreSQL 16 + Redis 7 trong Docker). CI chạy lại toàn bộ trên Ubuntu + Node 20 ở mỗi PR.

## 1. Chiến lược

| Tầng | Công cụ | Chạy trên | Kiểm tra gì |
|---|---|---|---|
| Unit | Jest + ts-jest | Không cần DB / Redis (mock repository, client giả) | Logic nghiệp vụ trong service: máy trạng thái đơn, tính tiền, idempotency, cache, rate limit, OTP, guardrail AI, vòng lặp agent, duyệt đề xuất… |
| Integration | Jest + Supertest + socket.io-client | PostgreSQL **thật** (DB `shopfast_test`) + Redis **thật** (DB số 1) | Toàn bộ HTTP API qua `AppModule` thật: auth, phân quyền, đơn hàng đồng thời, cache, rate limit 429, WebSocket, job nền, hỗ trợ + AI (Mock) |
| UI smoke | Chrome headless (playwright-core) | Backend + worker + Vite chạy thật | 11 luồng người dùng, gồm cập nhật realtime giữa 2 trình duyệt |
| Bảo mật | gitleaks | Toàn bộ lịch sử git | Không có secret bị commit |

Integration test có chốt an toàn: chỉ xoá dữ liệu trên database tên kết thúc bằng `_test` và Redis
DB khác 0.

## 2. Kết quả

| Bộ test | Số test | Kết quả |
|---|---|---|
| Unit (22 file `*.spec.ts`) | 287 | ✅ 287 pass |
| Integration (10 file `*.e2e-spec.ts`) | 104 test case trong file → 107 lần chạy (`it.each`) | ✅ 107 pass |
| UI smoke (Chrome headless) | 11 luồng | ✅ 11 pass |
| gitleaks (88 commit) | — | ✅ không có secret |

Integration theo nhóm yêu cầu:

| File | Yêu cầu | Số test |
|---|---|---|
| `auth.e2e-spec.ts` | F06.4 xác thực, refresh token xoay vòng | 11 |
| `users.e2e-spec.ts` | F06.4 phân quyền admin | 5 |
| `catalog.e2e-spec.ts` | F06.1 lọc, phân trang | 18 |
| `orders.e2e-spec.ts` | F06.2–3 giỏ hàng, đặt đơn, **8 khách cùng mua SP còn 3 → đúng 3 đơn** | 18 |
| `cache.e2e-spec.ts` | F04 cache, làm mới khi đổi giá / tồn kho, Redis hỏng | 10 |
| `jobs.e2e-spec.ts` | F05 hàng đợi, idempotency 1 email / đơn, dead letter | 12 |
| `rate-limit.e2e-spec.ts` | F03 429 + Retry-After, khoá dò mật khẩu, OTP | 7 |
| `realtime.e2e-spec.ts` | F02 xác thực bắt tay, cô lập phòng, kết nối lại, độ trễ | 7 |
| `support.e2e-spec.ts` | F01 phân loại, tool dữ liệu thật, duyệt thao tác ghi | 10 |
| `health.e2e-spec.ts` | F07.1, F07.3 health + Swagger | 6 |

## 3. Độ phủ (unit test, backend)

Lệnh: `cd backend && npm run test:cov` (báo cáo HTML: `backend/coverage/lcov-report/index.html`).

| Chỉ số | Toàn bộ code | Tầng nghiệp vụ (26 file `*.service.ts`) |
|---|---|---|
| Lines | **63,12 %** (1558/2468) | **91,2 %** (gộp) — file thấp nhất 60 % |
| Statements | 63,46 % | — |
| Branches | 65,91 % | — |
| Functions | 47,91 % | — |

**Ngưỡng bắt buộc trong CI** (`backend/package.json` → `jest.coverageThreshold`):

- `./src/**/*.service.ts`: **mỗi file ≥ 60 % lines và statements** — đúng yêu cầu SRS "độ phủ tầng
  nghiệp vụ ≥ 60 %", áp cho TỪNG file chứ không lấy trung bình (một service 0 % không thể trốn sau
  service 100 %).
- Phần còn lại (controller, repository, gateway, processor — kiểm bằng integration test): mức sàn
  chống tụt `lines 40 / statements 40 / branches 45 / functions 25`.

Đã kiểm tra ngược: tạm nâng ngưỡng service lên 95 % → Jest báo fail kèm tên từng file chưa đạt
(prisma.service 60 %, orders.service 81 %…) → ngưỡng thực sự được áp dụng.

**Trung thực về giới hạn:** độ phủ trên chỉ tính **unit test**. Controller / repository có độ phủ unit
thấp (~43 %) vì chúng được kiểm bằng integration test trên DB thật (107 test) — Jest không gộp hai
báo cáo này. Không có file nào bị loại khỏi báo cáo để làm đẹp số liệu (chỉ loại `main.ts`,
`*.module.ts`, `*.spec.ts`).

## 4. CI (GitHub Actions — `.github/workflows/ci.yml`)

Chạy cho mọi Pull Request và mỗi lần push vào `develop` / `main`:

| Job | Bước |
|---|---|
| `secret-scan` | gitleaks trên toàn bộ lịch sử |
| `backend-quality` | install → `prisma generate` → **lint** → **format check** → **unit test + coverage (có ngưỡng)** → tóm tắt độ phủ vào Job Summary → **build** |
| `backend-integration` | PostgreSQL 16 + Redis 7 (service containers) → migrate → **integration test** |
| `frontend-quality` | install → lint → format check → type check + build |

Bất kỳ job nào fail → PR bị chặn merge (**cần bật branch protection** cho `develop` / `main` và đánh dấu
4 job trên là *required* — xem `README.md`).

## 5. Cách chạy lại

```bash
docker compose up -d                      # PostgreSQL + Redis + Mailpit
cd backend
npm test                                   # unit
npm run test:cov                           # unit + độ phủ + ngưỡng
npm run test:e2e                           # integration (tự tạo DB shopfast_test qua migrate)
```
