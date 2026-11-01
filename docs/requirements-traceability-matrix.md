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
| F04.1 | Cache chi tiết + danh mục có lọc, lần 2 < 20 ms | `cache/cache.service.ts` (cache-aside), `cache/catalog-cache.ts`; `product:<id>` TTL 10'; danh sách chỉ cache **id + tổng** `products:list:v<N>:<hash>` TTL 5'; danh mục/thương hiệu; header `X-Cache` | Integration `cache.e2e-spec`: lần 2 HIT, spy repository chỉ 1 lần truy vấn. Đo thật: chi tiết 14,5 → 3 ms, danh mục lọc 19,8 → 5–7 ms ([performance-report](performance-report.md)) | P7 · `feature/redis-caching` | ✅ |
| F04.2 | Đổi giá/tồn kho → làm mới cache ngay | `CatalogCacheInvalidator`: xoá `product:<id>` (+ xoá lần 2 sau 1 s) khi admin sửa SP, kho nhập/xuất, đặt/huỷ đơn; tăng `catalog:version` khi tập kết quả lọc có thể đổi | Integration: đổi giá → chi tiết & danh sách (kể cả thứ tự sắp xếp) có giá mới ngay; đặt đơn / nhập kho → tồn kho mới; ngừng bán → biến mất; đổi tên danh mục → tên mới | P7 · `feature/redis-caching` | ✅ |
| F04.3 | Chống stampede + penetration | Khoá `SET lock:<key> NX PX 3000` + chờ đọc lại; giải phóng khoá bằng Lua; TTL ±10% jitter; `__NULL__` TTL 60 s cho id không tồn tại; id sai định dạng → 400 | Unit `cache.spec`: **50 request đồng thời khi cache trống → DB gọi 1 lần**; id không tồn tại lần 2 không gọi DB. Integration: lần 2 bị chặn ở cache (spy) | P7 · `feature/redis-caching` | ✅ |
| F04.4 | Redis hỏng vẫn phục vụ | ioredis `enableOfflineQueue: false` + `commandTimeout: 500`; mọi lệnh cache bọc try/catch → `BYPASS` đọc DB | Unit: Redis lỗi → BYPASS. Integration: spy Redis lỗi → 200 `BYPASS`. Thủ công: tắt container Redis → chi tiết/danh sách/danh mục vẫn 200, bật lại → HIT | P7 · `feature/redis-caching` | ✅ |
| F05.1 | Email / hoá đơn / đồng bộ kho qua queue | Tiến trình riêng `src/worker.ts` + `jobs/worker.module.ts`; queues `email`, `invoice`, `inventory-sync`, `scheduled`; `JobsProducer`; transactional outbox `job_outbox` ghi trong transaction đặt đơn | Unit: `jobs.spec` (producer, dispatcher). Integration: `jobs.e2e-spec` — đặt đơn → job có trong queue; queue hỏng → đơn vẫn 201, outbox đẩy lại được. Thủ công: đặt đơn 62 ms; Redis tắt → 201 trong 33 ms, ~64 s sau khi Redis bật lại job được đẩy | P8 · `feature/background-jobs` | ✅ |
| F05.2 | Retry + backoff + DLQ kèm lý do | `jobs/queues.ts` `QUEUE_JOB_OPTIONS` (email 5 lần/2s, hoá đơn 3/1s, đồng bộ kho 8/5s, exponential); `processors/base.processor.ts` → bảng `failed_jobs`; `GET /api/admin/jobs/failed`, `POST …/:id/retry` | Unit: `isFinalFailure`, chỉ ghi dead letter ở lần cuối. Integration: xem + chạy lại job lỗi. Thủ công: SMTP sai cấu hình → 5 lần thử (2s, 4s, 8s, 16s) → `failed_jobs` có lý do → sửa → retry → email tới Mailpit | P8 · `feature/background-jobs` | ✅ |
| F05.3 | Idempotent, đúng 1 email / đơn | `jobId` theo nghiệp vụ (không chứa `:`); `email_logs.dedupe_key` UNIQUE + giành quyền gửi bằng UPDATE có điều kiện; `invoices.order_id` UNIQUE; `inventory_sync_logs.dedupe_key` UNIQUE + Idempotency-Key gửi đối tác; báo cáo UPSERT theo ngày | Unit: `email.service.spec`, `jobs.spec`. Integration: **5 worker gửi song song + retry → đúng 1 email**; 3 worker tạo hoá đơn cùng lúc → 1 hoá đơn; đẩy cùng sự kiện 3 lần → 1 job. Thủ công: retry job đã gửi → "Bỏ qua", Mailpit vẫn 1 thư | P8 · `feature/background-jobs` | ✅ |
| F05.4 | Nhắc thanh toán 30' + báo cáo đêm | Delayed job `payment-reminder` (`PAYMENT_REMINDER_DELAY_MS`, chỉ đơn MOCK_ONLINE, kiểm tra lại lúc chạy); `upsertJobScheduler` cron `0 23 * * *` tz `Asia/Ho_Chi_Minh`; `POST /api/admin/reports/daily-revenue` chạy bù | Unit: reminder bỏ qua đơn đã trả/huỷ; `vnDayRange`; doanh thu BigInt. Integration: job delayed 30'; báo cáo chạy 2 lần → 1 bản ghi, 1 email/admin | P8 · `feature/background-jobs` | ✅ |
| F06.1 | Lọc danh mục / giá / thương hiệu + phân trang | `catalog/products` `GET /api/products?categoryId&brandId&minPrice&maxPrice&q&sort&page&limit`; `catalog/categories`, `catalog/brands`; seed 500 sản phẩm | Unit: `products.service.spec` (`buildWhere`, phân trang, version khi đổi giá). Integration: `catalog.e2e-spec` (từng bộ lọc, phân trang, 400 khi tham số sai, ẩn SP ngừng bán, RBAC quản trị, CHECK stock ≥ 0) | P3 · `feature/product-management` | ✅ |
| F06.2 | Giỏ hàng, đặt đơn, không bán vượt | `cart/`; `orders/orders.repository.ts` `placeOrder` (1 transaction: trừ kho `UPDATE … WHERE stock >= n AND price = giá đã thấy`, khoá theo thứ tự id chống deadlock); header `Idempotency-Key` + `UNIQUE(user_id, idempotency_key)`; `promotions/` + `POST /orders/promotional` (trừ lượt nguyên tử, advisory lock theo khách) | Unit: `orders.service.spec`, `cart.service.spec`, `order-logic.spec`. Integration: `orders.e2e-spec` — **8 khách mua đồng thời SP còn 3 → đúng 3 đơn**, cùng key gửi 3 lần đồng thời → 1 đơn, 2 đơn KM đồng thời của 1 khách → 1 đơn | P3 · `feature/order-management` | ✅ |
| F06.3 | Lịch sử đơn + kho cập nhật trạng thái | `GET /orders/me`, `GET /orders/:id` (khách chỉ xem đơn mình → 404), `PATCH /orders/:id/status` + `order-state-machine.ts` + khoá lạc quan; huỷ → hoàn kho; `inventory/` nhập/xuất kho + nhật ký `inventory_movements` | Unit: máy trạng thái (hợp lệ/không hợp lệ), hoàn kho, COD → PAID khi giao. Integration: vòng đời đủ 5 bước, nhảy bước → 409, khách PATCH → 403, huỷ hoàn kho, nhập/xuất kho | P3 · `feature/order-management` | ✅ |
| F06.4 | JWT + phân quyền vai trò | `auth/` (register, login, refresh xoay vòng, logout), `common/guards/` (`JwtAuthGuard` toàn cục, `RolesGuard`), `users/` (quản lý vai trò/trạng thái) | Unit: `auth.service.spec`, `guards.spec`, `users.service.spec`. Integration: `auth.e2e-spec` (cookie httpOnly, hash bcrypt, chặn tự gán role, phát hiện tái sử dụng refresh token), `users.e2e-spec` (3 vai trò nhân viên/khách → 403, ADMIN → 200, khoá tài khoản) | P2 · `feature/authentication` | ✅ |
| F07.1 | Health DB + Redis | `health/` terminus | Integration: `/health` 200 với `database`, `redis` = up | P1 (cơ bản) → P10 · `feature/monitoring` | ⬜ |
| F07.2 | Dashboard hàng đợi | API: `GET /api/admin/queues` (waiting/active/completed/failed/delayed + outbox chờ) — **giao diện** làm ở Phase 9/10 | Integration: `jobs.e2e-spec` (ADMIN 200, khách 403, số liệu đúng) | P8 (API) → P10 (UI) · `feature/monitoring` | 🟨 |
| F07.3 | Swagger tự sinh | `/api/docs` | Integration: `/api/docs-json` trả OpenAPI hợp lệ | P10 · `feature/monitoring` | ⬜ |
| F07.4 | Backup hằng ngày, tách biệt | `infra/backup/backup.sh`, cron, S3 | Diễn tập khôi phục thật (biên bản) | P14 · `feature/backup-recovery` | ⬜ |

## Yêu cầu phi chức năng

| Mã | Yêu cầu | Hiện thực | Bằng chứng | Phase | Trạng thái |
|---|---|---|---|---|---|
| NFR-TECH-01 | NestJS 10 / Node 20 / TS / PG 16 / Redis 7 | `package.json`, `.nvmrc`, image tags | File cấu hình | P1 | ⬜ |
| NFR-TECH-02 | Docker + Compose | `docker-compose*.yml`, Dockerfile | `docker compose up` chạy được | P1, P12 | ⬜ |
| NFR-TECH-03 | Mọi thay đổi vào main qua PR | Branch protection | Ảnh chụp cấu hình + lịch sử PR | P12 | ⬜ |
| NFR-TECH-04 | Tách controller / service / repository | Cấu trúc module | Code review, ESLint rule cấm import Prisma trong controller | Mọi phase | ⬜ |
| NFR-PERF-01 | Tra cứu có cache < 50 ms p95 | Cache P7 | k6 cục bộ: **p95 chi tiết 8,53 ms, danh sách 16,47 ms** — [performance-report](performance-report.md). Còn đo lại trên EC2 | P7, P13 | 🟨 |
| NFR-PERF-02 | Đặt hàng < 300 ms p95 | Transaction gọn, job nền | k6 | P8, P11 | ⬜ |
| NFR-PERF-03 | Realtime < 1 s | Gateway P5 | Script đo độ trễ | P5, P11 | ⬜ |
| NFR-PERF-04 | Cache hit ≥ 80% | `CacheMetrics`, `GET /api/admin/metrics/cache`, header `X-Cache` | k6 cục bộ: **99,39 %** request HIT (tập nóng 100 SP) — cần đo với phân bố thực tế hơn | P7 | 🟨 |
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
