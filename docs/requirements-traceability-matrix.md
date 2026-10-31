# Ma trận truy vết yêu cầu (Requirements Traceability Matrix)

Mỗi dòng nối **yêu cầu SRS → module/thành phần hiện thực → kiểm thử chứng minh → phase/branch**.
Cột *Trạng thái* được cập nhật **chỉ khi đã có code + test chạy thật**.

Chú thích trạng thái: ⬜ Chưa làm · 🟨 Đang làm · ✅ Xong & đã kiểm thử · ⚠️ Xong một phần (ghi rõ lý do)

Định nghĩa chi tiết từng mã: xem [requirements.md](requirements.md).

## Yêu cầu chức năng

| Mã | Yêu cầu (rút gọn) | Hiện thực (backend / frontend) | Kiểm thử chứng minh | Phase · Branch | Trạng thái |
|---|---|---|---|---|---|
| F01.1 | Tự phân loại ticket | `support/ticket-classifier.service.ts`, queue `ticket-classification`, fallback từ khoá | Unit: classifier với mock LLM (đúng nhóm, JSON sai → fallback). Integration: tạo ticket → job → có `category` | P4 · `feature/ai-support-agent` | ⬜ |
| F01.2 | 2 tool tra cứu dữ liệu thật | `ai/tools/get-order-status.tool.ts`, `ai/tools/check-product-inventory.tool.ts` → gọi `OrdersService`, `InventoryService` | Unit: tool trả đúng dữ liệu DB, đơn không tồn tại → "không tìm thấy". Integration: hỏi AI (mock adapter) → có tool call → câu trả lời chứa dữ liệu thật | P4 · `feature/ai-support-agent` | ⬜ |
| F01.3 | Từ chối ngoài phạm vi, không bịa | System prompt + `ai/guardrails.ts` (kiểm tra câu trả lời có nhắc mã đơn mà không có tool call → chặn) | Unit: câu hỏi ngoài phạm vi → từ chối. Guardrail: phản hồi bịa mã đơn → bị chặn | P4 · `feature/ai-support-agent` | ⬜ |
| F01.4 | Thao tác ghi cần người duyệt | `ai_pending_actions`, `POST /support/actions/:id/approve|reject` | Integration: AI đề xuất huỷ đơn → đơn **chưa** đổi; approve → đổi; reject → không đổi; khách hàng không gọi được approve (403) | P4 · `feature/ai-support-agent` | ⬜ |
| F02.1 | Cập nhật realtime khi kho đổi trạng thái | `realtime/orders.gateway.ts`, event `order.status.changed` | Integration (socket.io-client trong Jest): PATCH status → client nhận `order:status` | P5 · `feature/realtime-tracking` | ⬜ |
| F02.2 | Chỉ gửi tới người theo dõi đơn đó | Phòng `order:{id}` | Integration: khách B không nhận sự kiện đơn của khách A | P5 · `feature/realtime-tracking` | ⬜ |
| F02.3 | Xác thực khi bắt tay + chỉ đơn của mình | Socket middleware JWT, kiểm tra ownership khi subscribe | Integration: không token → `connect_error`; subscribe đơn người khác → lỗi `FORBIDDEN` | P5 · `feature/realtime-tracking` | ⬜ |
| F02.4 | Tự reconnect & đăng ký lại | `frontend/src/realtime/useOrderTracking.ts` | Integration: ngắt kết nối server-side → client reconnect → vẫn nhận sự kiện | P5 · `feature/realtime-tracking` | ⬜ |
| F03.1 | Rate limit toàn bộ API (Redis) | `rate-limit/` ThrottlerModule + Redis storage, guard toàn cục | Integration: vượt hạn mức mặc định → 429 | P6 · `feature/rate-limiting` | ⬜ |
| F03.2 | Hạn mức chặt cho login / mã xác thực / đơn khuyến mãi | `@Throttle()` trên 3 endpoint | Integration: mỗi endpoint vượt hạn mức riêng → 429 trước hạn mức chung | P6 · `feature/rate-limiting` | ⬜ |
| F03.3 | Định danh theo tài khoản / IP | `rate-limit/user-or-ip.tracker.ts` | Unit: có user → `user:{id}`; không → `ip:{ip}` | P6 · `feature/rate-limiting` | ⬜ |
| F03.4 | 429 + Retry-After + tiếng Việt | `common/filters/throttler-exception.filter.ts` | Integration: kiểm tra header `Retry-After` và message tiếng Việt | P6 · `feature/rate-limiting` | ⬜ |
| F03.5 | Chặn leo thang dò mật khẩu theo tài khoản | `auth/login-attempts.service.ts` | Unit: 5/10/20 lần sai → khoá 1'/15'/60'; đúng → reset. Integration: đổi IP vẫn bị khoá | P6 · `feature/rate-limiting` | ⬜ |
| F04.1 | Cache chi tiết + danh mục có lọc, lần 2 < 20 ms | `cache/cache.service.ts`, `products/products.service.ts` | Integration: lần 2 không gọi DB (spy repository). Đo thật: `perf/` k6 | P7 · `feature/redis-caching` | ⬜ |
| F04.2 | Đổi giá/tồn kho → làm mới cache ngay | Invalidation trong `ProductsService.update`, `InventoryService.adjust`, sau đặt đơn | Integration: cập nhật giá → GET ngay trả giá mới | P7 · `feature/redis-caching` | ⬜ |
| F04.3 | Chống stampede + penetration | Lock `SET NX PX`, null marker | Unit: 50 request đồng thời khi miss → DB chỉ bị gọi 1 lần; ID không tồn tại lần 2 → không gọi DB | P7 · `feature/redis-caching` | ⬜ |
| F04.4 | Redis hỏng vẫn phục vụ | try/catch + timeout trong `CacheService` | Integration: Redis client lỗi → API vẫn 200 | P7 · `feature/redis-caching` | ⬜ |
| F05.1 | Email / hoá đơn / đồng bộ kho qua queue | `jobs/` queues `email`, `invoice`, `inventory-sync`; `worker.ts` | Integration: `POST /orders` trả về không chờ email; job được thêm vào queue | P8 · `feature/background-jobs` | ⬜ |
| F05.2 | Retry + backoff + DLQ kèm lý do | `jobs/queue.config.ts`, `failed_jobs` | Unit: processor ném lỗi đủ lần → bản ghi `failed_jobs` có `reason` | P8 · `feature/background-jobs` | ⬜ |
| F05.3 | Idempotent, đúng 1 email / đơn | `jobId` cố định + unique `email_logs(order_id, type)` | Unit/Integration: chạy processor 2 lần cùng đơn → mailer gọi 1 lần | P8 · `feature/background-jobs` | ⬜ |
| F05.4 | Nhắc thanh toán 30' + báo cáo đêm | Delayed job, repeatable cron | Unit: đơn đã thanh toán → không nhắc. Báo cáo chạy 2 lần cùng ngày → 1 bản ghi | P8 · `feature/background-jobs` | ⬜ |
| F06.1 | Lọc danh mục / giá / thương hiệu + phân trang | `products/` `GET /products` | Integration: các tổ hợp lọc, `page/limit`, DTO sai → 400 | P3 · `feature/product-management` | ⬜ |
| F06.2 | Giỏ hàng, đặt đơn, không bán vượt | `cart/`, `orders/` transaction + trừ kho có điều kiện | Integration: 2 đơn đồng thời cho sản phẩm còn 1 → chỉ 1 đơn thành công; `Idempotency-Key` trùng → không tạo đơn 2 | P3 · `feature/order-management` | ⬜ |
| F06.3 | Lịch sử đơn + kho cập nhật trạng thái | `GET /orders/me`, `PATCH /orders/:id/status`, state machine | Unit: chuyển trạng thái sai → lỗi. Integration: khách không PATCH được (403) | P3 · `feature/order-management` | ⬜ |
| F06.4 | JWT + phân quyền vai trò | `auth/` (register, login, refresh xoay vòng, logout), `common/guards/` (`JwtAuthGuard` toàn cục, `RolesGuard`), `users/` (quản lý vai trò/trạng thái) | Unit: `auth.service.spec`, `guards.spec`, `users.service.spec`. Integration: `auth.e2e-spec` (cookie httpOnly, hash bcrypt, chặn tự gán role, phát hiện tái sử dụng refresh token), `users.e2e-spec` (3 vai trò nhân viên/khách → 403, ADMIN → 200, khoá tài khoản) | P2 · `feature/authentication` | ✅ |
| F07.1 | Health DB + Redis | `health/` terminus | Integration: `/health` 200 với `database`, `redis` = up | P1 (cơ bản) → P10 · `feature/monitoring` | ⬜ |
| F07.2 | Dashboard hàng đợi | `GET /admin/queues`, trang Admin Queues | Integration: số liệu đúng sau khi thêm job | P10 · `feature/monitoring` | ⬜ |
| F07.3 | Swagger tự sinh | `/api/docs` | Integration: `/api/docs-json` trả OpenAPI hợp lệ | P10 · `feature/monitoring` | ⬜ |
| F07.4 | Backup hằng ngày, tách biệt | `infra/backup/backup.sh`, cron, S3 | Diễn tập khôi phục thật (biên bản) | P14 · `feature/backup-recovery` | ⬜ |

## Yêu cầu phi chức năng

| Mã | Yêu cầu | Hiện thực | Bằng chứng | Phase | Trạng thái |
|---|---|---|---|---|---|
| NFR-TECH-01 | NestJS 10 / Node 20 / TS / PG 16 / Redis 7 | `package.json`, `.nvmrc`, image tags | File cấu hình | P1 | ⬜ |
| NFR-TECH-02 | Docker + Compose | `docker-compose*.yml`, Dockerfile | `docker compose up` chạy được | P1, P12 | ⬜ |
| NFR-TECH-03 | Mọi thay đổi vào main qua PR | Branch protection | Ảnh chụp cấu hình + lịch sử PR | P12 | ⬜ |
| NFR-TECH-04 | Tách controller / service / repository | Cấu trúc module | Code review, ESLint rule cấm import Prisma trong controller | Mọi phase | ⬜ |
| NFR-PERF-01 | Tra cứu có cache < 50 ms p95 | Cache P7 | Kết quả k6 thật trong `testing-report.md` | P7, P11 | ⬜ |
| NFR-PERF-02 | Đặt hàng < 300 ms p95 | Transaction gọn, job nền | k6 | P8, P11 | ⬜ |
| NFR-PERF-03 | Realtime < 1 s | Gateway P5 | Script đo độ trễ | P5, P11 | ⬜ |
| NFR-PERF-04 | Cache hit ≥ 80% | Metrics P7 | `/admin/metrics/cache` sau khi chạy k6 | P7 | ⬜ |
| NFR-PERF-05 | Deploy < 10 phút | Pipeline P12 | Thời lượng run GitHub Actions | P12 | ⬜ |
| NFR-SEC-01 | HTTPS + redirect | Nginx + certbot | `curl -I http://...` → 301 | P13 | ⬜ |
| NFR-SEC-02 | SG tối thiểu, DB/Redis không public | SG + compose prod | Ảnh chụp SG, `nmap` từ ngoài | P13 | ⬜ |
| NFR-SEC-03 | Không khoá dài hạn | OIDC + Instance Role | Workflow dùng `aws-actions/configure-aws-credentials` với `role-to-assume` | P12, P13 | ⬜ |
| NFR-SEC-04 | Không secret trong code / Dockerfile / pipeline | `.env.example`, GitHub Secrets, gitleaks | CI job gitleaks xanh | P1, P11 | ⬜ |
| NFR-SEC-05 | IAM least privilege, group, MFA | Tài liệu + policy JSON | `deployment-guide.md` | P13 | ⬜ |
| NFR-REL-01 | Deploy không gián đoạn | Blue-green | Chạy k6 trong lúc deploy → 0 lỗi | P12 | ⬜ |
| NFR-REL-02 | Health check sau deploy, rollback < 2' | `infra/deploy/deploy.sh` | Lần deploy cố tình hỏng → rollback, đo thời gian | P12 | ⬜ |
| NFR-REL-03 | Diễn tập khôi phục < 30' | `restore.sh` | Biên bản đo thật | P14 | ⬜ |
| NFR-REL-04 | Suy giảm có kiểm soát | Fallback Redis/AI/email | Test F04.4, F01 fallback | P4, P7, P8 | ⬜ |
| NFR-QUA-01 | Coverage nghiệp vụ ≥ 60% | Jest threshold | Coverage report | P11 | ⬜ |
| NFR-QUA-02 | CI chặn merge khi fail | GitHub Actions + protection | Link run bị chặn (D03) | P11, P12 | ⬜ |
| NFR-QUA-03 | Image tag theo SHA | Workflow build | Danh sách tag trong registry | P12 | ⬜ |

## Rubric & Deliverables

| Mã | Nội dung | Phụ thuộc | Trạng thái |
|---|---|---|---|
| R01 / D01 | Chạy thật bằng domain HTTPS | NFR-SEC-01, P13 | ⬜ |
| R02 / D05 | ≥ 5 chủ đề tích hợp thực chất | F01–F05, F07 | ⬜ |
| R03 / D03 | Demo deploy tự động + rollback; có run bị chặn | P12 | ⬜ |
| R04 | Không khoá dài hạn, cổng tối thiểu, backup, giám sát | NFR-SEC-02/03, F07 | ⬜ |
| R05 / D04 / D06 | Clean code, coverage, tài liệu, biên bản khôi phục | P11, P14, P15 | ⬜ |
| R06 | Bảo vệ quyết định kỹ thuật | `technical-decisions.md`, `defense-questions.md` | ⬜ |
| D02 | GitHub + README | P1 | ⬜ |
| D07 | Slide + kịch bản demo | P15 | ⬜ |
| D08 | UI web | P9 | ⬜ |
