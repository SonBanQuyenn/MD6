# Phân tích yêu cầu — ShopFast

> Nguồn gốc: *Module 06 – Software Requirement Specification (SRS)* (đề bài Defense Case Study 6).
> SRS là nguồn sự thật chính. File này **tách từng yêu cầu thành mã định danh** để dùng trong
> [ma trận truy vết](requirements-traceability-matrix.md), và giải thích *yêu cầu nghĩa là gì* +
> *ta sẽ đáp ứng bằng cách nào*.

Quy ước mã:

| Tiền tố | Ý nghĩa |
|---|---|
| `F0x.y` | Yêu cầu chức năng (Functional) |
| `NFR-TECH-xx` | Phi chức năng — công nghệ & kiến trúc |
| `NFR-PERF-xx` | Phi chức năng — hiệu năng |
| `NFR-SEC-xx` | Phi chức năng — bảo mật |
| `NFR-REL-xx` | Phi chức năng — độ tin cậy & phục hồi |
| `NFR-QUA-xx` | Phi chức năng — chất lượng mã |
| `D0x` | Sản phẩm bàn giao (Deliverable) |
| `R0x` | Tiêu chí chấm điểm bảo vệ (Rubric) |

---

## 1. Bối cảnh

- **Hệ thống:** backend sàn TMĐT ShopFast, ~**200.000 khách hàng**.
- **Phạm vi SRS:** tập trung backend (API, realtime, xử lý nền, hạ tầng). UI chỉ cần tối thiểu,
  nhưng SRS mục 6 ghi rõ **"Có triển khai UI web"** và PRD yêu cầu frontend hoàn chỉnh → ta làm
  frontend React đầy đủ các trang (xem Phase 9 trong [roadmap](development-roadmap.md)).
- **Kế thừa Module 5:** NestJS + PostgreSQL.
- **Môi trường chạy:** container trên **AWS EC2**, sau **Nginx** reverse proxy có **HTTPS**;
  PostgreSQL và Redis cùng mạng nội bộ, **không phơi cổng ra Internet**.
- **Giả định:** tài khoản AWS đã bảo mật theo Session 07; khoá AI do lớp cấp; dữ liệu ban đầu nạp
  bằng **script seed**.

### Đối tượng người dùng (vai trò hệ thống)

| Vai trò SRS | Role trong code | Việc chính |
|---|---|---|
| Khách hàng | `CUSTOMER` | Xem sản phẩm, giỏ hàng, đặt đơn, theo dõi đơn realtime, gửi ticket hỗ trợ |
| Nhân viên CSKH | `SUPPORT_AGENT` | Xử lý ticket, dùng trợ lý AI tra đơn / tồn kho, duyệt đề xuất của AI |
| Nhân viên kho | `WAREHOUSE_STAFF` | Cập nhật trạng thái đơn, quản lý tồn kho |
| Quản trị / DevOps | `ADMIN` | Giám sát sức khoẻ hệ thống, hàng đợi, người dùng, sản phẩm, pipeline |

---

## 2. Yêu cầu chức năng

### F01 — Trợ lý AI hỗ trợ CSKH (Session 01)

| Mã | Yêu cầu (SRS) | Nghĩa là gì | Cách đáp ứng |
|---|---|---|---|
| F01.1 | Tự động phân loại ticket vào đúng nhóm nghiệp vụ | Khi khách gửi ticket, hệ thống tự gán nhóm (đơn hàng, giao hàng, thanh toán, đổi trả, sản phẩm, tài khoản, khác) | Ticket mới → đẩy job `ticket-classification` (BullMQ) → LLM trả về nhóm + độ tin cậy dạng JSON có kiểm tra schema. Nếu AI lỗi → bộ phân loại từ khoá dự phòng, đánh dấu `classifiedBy = FALLBACK` |
| F01.2 | Tối thiểu 2 công cụ tra cứu dữ liệu thật: trạng thái đơn và tồn kho theo mã SP | AI phải *gọi hàm* (tool/function calling) để lấy dữ liệu từ DB, không tự trả lời | Tool `getOrderStatus(orderId)` và `checkProductInventory(productId)` gọi vào `OrdersService` / `InventoryService` (đi qua tầng nghiệp vụ, không truy vấn DB trực tiếp từ tầng AI) |
| F01.3 | Từ chối lịch sự câu hỏi ngoài phạm vi; không bịa thông tin đơn khi chưa tra cứu | AI không trả lời chuyện thời tiết, code, chính trị…; không được "đoán" trạng thái đơn | System prompt giới hạn phạm vi + quy tắc "chỉ nêu dữ liệu đơn/tồn kho lấy từ kết quả tool". Có test với adapter giả lập kiểm tra luồng từ chối và luồng bắt buộc gọi tool |
| F01.4 | Mọi thao tác **ghi** do agent đề xuất phải qua xác nhận của con người | AI chỉ được *đề xuất* (ví dụ huỷ đơn, cập nhật địa chỉ); nhân viên bấm Duyệt thì mới thực thi | Tool ghi (`proposeOrderAction`) chỉ tạo bản ghi `ai_pending_actions` trạng thái `PENDING`. Endpoint `POST /support/actions/:id/approve` (role `SUPPORT_AGENT`) mới gọi service thực thi. Có audit ai duyệt, lúc nào |

Bổ sung từ PRD (không mâu thuẫn SRS): xử lý lỗi nhà cung cấp AI êm (timeout, retry, thông báo rõ),
lưu lịch sử ticket + hội thoại, **không lộ API key ra frontend**, có **mock adapter được ghi nhãn
rõ ràng** khi không có key.

### F02 — Theo dõi đơn hàng thời gian thực (Session 02)

| Mã | Yêu cầu | Nghĩa là gì | Cách đáp ứng |
|---|---|---|---|
| F02.1 | Khách mở màn hình theo dõi, nhận cập nhật ngay khi kho đổi trạng thái, không tải lại trang | Đẩy (push) từ server xuống trình duyệt | Socket.IO qua NestJS WebSocket Gateway. `OrdersService.updateStatus()` phát sự kiện nội bộ → Gateway `emit` tới phòng của đơn |
| F02.2 | Sự kiện chỉ gửi tới đúng người theo dõi đơn đó | Không `broadcast` toàn server | Mỗi đơn một phòng riêng `order:{orderId}`; chỉ `server.to(room).emit(...)` |
| F02.3 | Xác thực tại thời điểm bắt tay; khách chỉ theo dõi đơn của mình | Kết nối không có JWT hợp lệ bị từ chối ngay; join phòng phải kiểm tra quyền sở hữu | Middleware handshake kiểm tra JWT trong `auth.token`. Sự kiện `order:subscribe` kiểm tra `order.userId === user.id` (hoặc user là nhân viên) trước khi `join` |
| F02.4 | Client tự kết nối lại và đăng ký lại kênh sau khi mất mạng | Rớt mạng → có mạng lại → vẫn nhận cập nhật | `socket.io-client` tự reconnect; trên sự kiện `connect` client gửi lại `order:subscribe` và gọi API lấy trạng thái mới nhất (bù sự kiện bị lỡ) |

Khi chạy nhiều instance API (triển khai không gián đoạn) cần **Redis adapter cho Socket.IO** để
sự kiện phát ở instance A tới được client đang nối vào instance B.

### F03 — Bảo vệ API khỏi lạm dụng (Session 03)

| Mã | Yêu cầu | Nghĩa là gì | Cách đáp ứng |
|---|---|---|---|
| F03.1 | Hạn mức tần suất cho **toàn bộ** API | Mọi endpoint đều có giới hạn mặc định | Guard rate limit toàn cục (`@nestjs/throttler`) lưu bộ đếm trong **Redis** (để nhiều instance dùng chung) |
| F03.2 | Hạn mức **chặt hơn** cho: đăng nhập, gửi mã xác thực, đặt đơn khuyến mãi | Các endpoint nhạy cảm có giới hạn riêng | Decorator `@Throttle` riêng cho `POST /auth/login`, `POST /auth/verification-code`, `POST /orders/promotional` |
| F03.3 | Khoá định danh: theo **tài khoản** khi đã đăng nhập, theo **IP** khi chưa | Hai người dùng chung IP (quán cà phê) không ảnh hưởng nhau khi đã login | Hàm `getTracker()` tuỳ biến: `user:{id}` nếu có JWT hợp lệ, ngược lại `ip:{ip}` (lấy IP thật qua `X-Forwarded-For` do Nginx đặt, cấu hình `trust proxy`) |
| F03.4 | Vượt hạn mức → **429** + thời gian chờ + thông điệp **tiếng Việt** thân thiện | | Exception filter trả `429`, header `Retry-After`, body `{ message: "Bạn thao tác quá nhanh, vui lòng thử lại sau 30 giây." , retryAfter: 30 }` |
| F03.5 | Chặn leo thang chống dò mật khẩu, **đếm theo từng tài khoản mục tiêu** | Kẻ tấn công đổi IP liên tục vẫn bị chặn vì đếm theo email bị nhắm | Redis đếm số lần đăng nhập sai theo `email`. Ngưỡng leo thang (ví dụ 5 lần → khoá 1 phút, 10 → 15 phút, 20 → 1 giờ). Đăng nhập đúng → reset. Thông báo chung chung để không lộ tài khoản có tồn tại hay không |

> "Gửi mã xác thực": SRS nhắc tới nhưng không mô tả nghiệp vụ. Ta hiện thực **mã OTP xác minh
> email / quên mật khẩu** (`POST /auth/verification-code`) để có endpoint thật áp dụng hạn mức.
> "Đặt đơn khuyến mãi": hiện thực bằng **mã khuyến mãi có số lượng giới hạn**
> (`POST /orders/promotional`). Xem [technical-decisions.md](technical-decisions.md) TD-12.

### F04 — Tăng tốc truy vấn bằng bộ nhớ đệm (Session 04)

| Mã | Yêu cầu | Nghĩa là gì | Cách đáp ứng |
|---|---|---|---|
| F04.1 | Trang chi tiết SP và trang danh mục có bộ lọc được cache; lần thứ 2 **< 20 ms** | Cache-aside cho `GET /products/:id` và `GET /products?...` | Redis, khoá `product:{id}` và `products:list:v{version}:{hash(query)}`, TTL có độ lệch ngẫu nhiên (jitter). Đo thật bằng k6 / log thời gian, ghi vào báo cáo |
| F04.2 | Giá hoặc tồn kho đổi → mọi bản cache liên quan làm mới **ngay**; khách không thấy giá cũ | Xoá/làm mới cache trong cùng luồng cập nhật | Sau khi commit transaction cập nhật giá/tồn kho: xoá `product:{id}` và **tăng version** danh sách (`INCR products:list:version`) → toàn bộ khoá danh sách cũ tự vô hiệu |
| F04.3 | Chống **dồn dập** khi khoá nóng hết hạn (cache stampede) và chống **dò khoá không tồn tại** (cache penetration) | Nhiều request cùng lúc không được cùng đập vào DB; request dò ID ảo không được xuyên thẳng xuống DB | Stampede: khoá phân tán `SET lock:{key} NX PX` — chỉ 1 request tải DB, số còn lại chờ ngắn rồi đọc cache. Penetration: cache giá trị rỗng (`NULL marker`) TTL ngắn + kiểm tra định dạng ID trước khi truy vấn |
| F04.4 | Redis không sẵn sàng → vẫn phục vụ, chỉ chậm hơn | Lỗi Redis không được làm sập API | Mọi thao tác cache bọc `try/catch` + timeout ngắn; lỗi → đọc thẳng DB. Có test tắt Redis |

Bổ sung PRD: đo **cache metrics** (hit/miss/hit ratio) — liên quan NFR-PERF-04 (≥ 80% hit).

### F05 — Xử lý tác vụ nền (Session 05)

| Mã | Yêu cầu | Nghĩa là gì | Cách đáp ứng |
|---|---|---|---|
| F05.1 | Email xác nhận, xuất hoá đơn, đồng bộ tồn kho với đối tác được đẩy ra hàng đợi, không chặn phản hồi | API đặt đơn trả về ngay; email gửi sau | BullMQ queue `email`, `invoice`, `inventory-sync`. Job được thêm **sau khi** transaction đặt đơn commit. Worker chạy tiến trình riêng |
| F05.2 | Mỗi tác vụ có số lần thử + chiến lược giãn dần (backoff); hết lượt → lưu riêng kèm lý do | Retry có exponential backoff; Dead Letter | `attempts` + `backoff: { type: 'exponential' }` theo từng queue. Sự kiện `failed` ở lần cuối → ghi bảng `failed_jobs` (queue, payload, lý do, stack) + queue `dead-letter`. Admin có thể chạy lại thủ công |
| F05.3 | Bất biến khi lặp (idempotent): chạy lại không nhân đôi tác dụng phụ; mỗi đơn đúng **1** email | Retry hoặc job bị thêm 2 lần vẫn chỉ gửi 1 email | (1) `jobId` cố định `order-confirmation:{orderId}` → BullMQ bỏ qua job trùng. (2) Bảng `email_logs` có **unique (orderId, type)**; worker ghi khoá trước khi gửi, trạng thái `SENDING → SENT`. Hoá đơn: unique `orderId` trong bảng `invoices` |
| F05.4 | Tác vụ theo lịch: **nhắc thanh toán sau 30 phút** và **báo cáo doanh thu hằng đêm** | | Nhắc thanh toán: delayed job 30 phút tạo khi đặt đơn; khi chạy kiểm tra đơn còn `UNPAID` mới gửi. Báo cáo: repeatable job cron `0 23 * * *` múi giờ `Asia/Ho_Chi_Minh`, lưu bảng `daily_revenue_reports` (unique theo ngày) + email admin |

Bổ sung PRD: admin xem trạng thái job; dùng **adapter email cục bộ** (Mailpit) khi chưa có SMTP thật.

### F06 — Nghiệp vụ đơn hàng nền tảng

| Mã | Yêu cầu | Cách đáp ứng |
|---|---|---|
| F06.1 | Danh mục SP lọc theo **danh mục, khoảng giá, thương hiệu** và **phân trang** | `GET /products?categoryId&brandId&minPrice&maxPrice&page&limit&sort` — DTO validate, index DB phù hợp |
| F06.2 | Giỏ hàng và đặt đơn; **kiểm tra tồn kho trước khi xác nhận**, **không bán vượt** | Giỏ hàng lưu DB. Đặt đơn trong **transaction**: trừ kho bằng câu lệnh có điều kiện `UPDATE ... SET stock = stock - n WHERE id = ? AND stock >= n` — 0 dòng bị ảnh hưởng → rollback, trả 409. Chống đặt trùng bằng header `Idempotency-Key` |
| F06.3 | Tra cứu lịch sử đơn của khách; kho cập nhật trạng thái đơn | `GET /orders/me`, `PATCH /orders/:id/status` (role `WAREHOUSE_STAFF`/`ADMIN`) với **máy trạng thái** chặn chuyển sai (VD `DELIVERED → PENDING`). Lưu `order_status_history` |
| F06.4 | Xác thực & phân quyền bằng token, phân biệt khách / nhân viên / quản trị | JWT access token (ngắn hạn) + refresh token (xoay vòng, lưu hash trong DB). `RolesGuard` + decorator `@Roles()` |

### F07 — Vận hành và giám sát (Session 06, 07, 08)

| Mã | Yêu cầu | Cách đáp ứng |
|---|---|---|
| F07.1 | Endpoint sức khoẻ trả trạng thái kết nối **DB** và **Redis** | `GET /health` (`@nestjs/terminus`): `database: up/down`, `redis: up/down`, mã 503 khi hỏng. Tách `/health/live` (process sống) và `/health/ready` (sẵn sàng nhận traffic) |
| F07.2 | Bảng theo dõi hàng đợi: **chờ, đang chạy, hoàn tất, thất bại** | `GET /admin/queues` trả `waiting/active/completed/failed/delayed` cho từng queue + trang Admin hiển thị, tự làm mới |
| F07.3 | Tài liệu API sinh tự động, truy cập được trên môi trường thử nghiệm | Swagger/OpenAPI tại `/api/docs` từ decorator `@nestjs/swagger` |
| F07.4 | Sao lưu DB tự động **hằng ngày**, lưu **tách biệt** máy chủ ứng dụng | Cron trên EC2 chạy `pg_dump` → nén → upload **S3** bằng **IAM Role của instance** (không có access key). Lifecycle S3 giữ 7 bản ngày + 4 bản tuần |

---

## 3. Yêu cầu phi chức năng

### Công nghệ & kiến trúc

| Mã | Yêu cầu | Cách đáp ứng |
|---|---|---|
| NFR-TECH-01 | NestJS 10, Node.js 20 LTS, TypeScript, PostgreSQL 16, Redis 7 | Khoá phiên bản trong `package.json`, `.nvmrc` = 20, image `node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine` |
| NFR-TECH-02 | Toàn bộ dịch vụ đóng gói Docker, dựng bằng Docker Compose | `docker-compose.yml` (dev) và `docker-compose.prod.yml` |
| NFR-TECH-03 | GitHub; mọi thay đổi vào nhánh chính qua **Pull Request** | Branch protection cho `main`/`develop`: bắt buộc PR + CI xanh |
| NFR-TECH-04 | Clean Code; tách **controller / service (nghiệp vụ) / repository (truy cập dữ liệu)** | Mỗi module NestJS có 3 tầng rõ ràng; controller không gọi Prisma trực tiếp |

### Hiệu năng (phải **đo thật**, không bịa số)

| Mã | Chỉ tiêu | Ngưỡng | Cách đo |
|---|---|---|---|
| NFR-PERF-01 | Phản hồi API tra cứu (có cache) | **< 50 ms p95** | k6 chạy `GET /products/:id`, `GET /products?...` |
| NFR-PERF-02 | Phản hồi endpoint đặt hàng | **< 300 ms p95** | k6 `POST /orders` với dữ liệu seed |
| NFR-PERF-03 | Độ trễ cập nhật trạng thái qua realtime | **< 1 giây** | Script đo thời điểm `PATCH status` → thời điểm client nhận sự kiện |
| NFR-PERF-04 | Tỉ lệ trúng cache dữ liệu SP | **≥ 80%** | Bộ đếm hit/miss, xem ở `/admin/metrics/cache` |
| NFR-PERF-05 | Thời gian một lần triển khai tự động | **< 10 phút** | Thời lượng workflow trên GitHub Actions |

### Bảo mật

| Mã | Yêu cầu | Cách đáp ứng |
|---|---|---|
| NFR-SEC-01 | Toàn bộ lưu lượng Internet qua HTTPS; HTTP tự chuyển hướng | Nginx `return 301 https://...`; chứng chỉ Let's Encrypt (certbot), HSTS |
| NFR-SEC-02 | Security Group: chỉ mở 80/443 cho mọi nơi; 22 chỉ IP quản trị; DB & Redis không ra Internet | Cấu hình SG + compose prod không `ports:` cho postgres/redis. Tốt hơn nữa: dùng **SSM Session Manager**, đóng hẳn cổng 22 |
| NFR-SEC-03 | Không có khoá truy cập dài hạn cho ứng dụng và pipeline; dùng Role + thông tin xác thực tạm thời | EC2 dùng **Instance Profile (IAM Role)**; GitHub Actions dùng **OIDC → AssumeRole** (credential tạm thời ~1 giờ) |
| NFR-SEC-04 | Không giá trị nhạy cảm trong mã nguồn, Dockerfile, file pipeline | `.env` bị gitignore; secret ở GitHub Secrets / AWS SSM Parameter Store; quét bằng `gitleaks` trong CI |
| NFR-SEC-05 | Phân quyền cloud: đặc quyền tối thiểu, cấp qua nhóm, bật MFA | IAM Group + policy tối thiểu; tài liệu hướng dẫn trong `deployment-guide.md` (do sinh viên thực hiện trên tài khoản AWS) |

### Độ tin cậy & phục hồi

| Mã | Yêu cầu | Cách đáp ứng |
|---|---|---|
| NFR-REL-01 | Triển khai bản mới **không gián đoạn** người dùng đang thao tác | **Blue-green** trên 1 EC2: dựng container mới, chờ `/health/ready` OK, Nginx chuyển upstream, `nginx -s reload` (không rớt kết nối), tắt container cũ sau khi drain |
| NFR-REL-02 | Health check sau triển khai; lỗi → **tự động quay lui** bản tốt gần nhất **< 2 phút** | Script deploy kiểm tra health N lần; thất bại → chuyển Nginx về màu cũ (container cũ vẫn chạy nên quay lui chỉ vài giây). Ghi lại tag SHA bản tốt gần nhất |
| NFR-REL-03 | Diễn tập khôi phục từ bản sao lưu **thật**, **< 30 phút** | Script `restore.sh` + biên bản đo giờ bắt đầu/kết thúc thật trong `backup-recovery-report.md` |
| NFR-REL-04 | Thành phần phụ trợ hỏng → suy giảm có kiểm soát | Redis hỏng → bỏ qua cache; AI hỏng → phân loại dự phòng + thông báo; email hỏng → retry/DLQ, đơn vẫn tạo được |

### Chất lượng mã

| Mã | Yêu cầu | Cách đáp ứng |
|---|---|---|
| NFR-QUA-01 | Độ phủ kiểm thử **tầng nghiệp vụ ≥ 60%** | Jest `coverageThreshold` áp cho `src/**/*.service.ts` + logic thuần; CI fail nếu dưới ngưỡng |
| NFR-QUA-02 | Pipeline chạy format check, unit test, integration test; fail → **khoá merge** | GitHub Actions + branch protection "Require status checks" |
| NFR-QUA-03 | Mọi image gắn thẻ cố định theo **commit SHA** | `shopfast-api:${GITHUB_SHA}`; không deploy tag `latest` |

---

## 4. Tiêu chí chấm điểm bảo vệ (Defense Rubric)

Trình bày **10 phút** + hỏi đáp **5 phút**.

| Mã | Tiêu chí | Trọng số | Điều kiện điểm tối đa | Ta chuẩn bị gì |
|---|---|---|---|---|
| R01 | Sản phẩm chạy thật | 25% | Truy cập bằng **tên miền có HTTPS**, ổn định suốt buổi | EC2 + domain + Let's Encrypt; uptime check trước buổi bảo vệ |
| R02 | Mức độ tích hợp | 25% | Tích hợp thực chất **≥ 5 chủ đề**, mỗi chủ đề giải quyết 1 bài toán nghiệp vụ | Ta làm cả 7 chủ đề: AI Agent, Realtime, Rate limit, Cache, Background jobs, Docker/CI-CD, Cloud/giám sát |
| R03 | Tự động hoá triển khai | 20% | Demo **trực tiếp** deploy tự động từ commit, có test và quay lui | Pipeline CI → build image SHA → deploy blue-green → health check → rollback; demo cả lần rollback |
| R04 | Bảo mật & vận hành | 15% | Không khoá dài hạn, cổng mở tối thiểu, có sao lưu và giám sát | OIDC + Instance Role, SG tối thiểu, backup S3, `/health` + dashboard hàng đợi |
| R05 | Chất lượng mã & tài liệu | 15% | Clean Code, coverage đạt ngưỡng, tài liệu kiến trúc đầy đủ | Coverage report, docs/ đầy đủ, sơ đồ |
| R06 | **Bảo vệ quyết định kỹ thuật** | **Điều kiện bắt buộc** | Giải thích được *vì sao chọn* và *xử lý khi sự cố* | `technical-decisions.md`, `defense-questions.md`; **bạn phải tự hiểu từng phần** — không giải thích được thì **không được công nhận kết quả** |

---

## 5. Sản phẩm bàn giao (Deliverables)

| Mã | Sản phẩm | Ghi chú |
|---|---|---|
| D01 | Link hệ thống chạy thật bằng tên miền HTTPS | Cần bạn có domain + tài khoản AWS |
| D02 | Link GitHub, README hướng dẫn cài & chạy cục bộ | |
| D03 | Link lịch sử pipeline: có lần **thành công** và **ít nhất 1 lần bị chặn do test fail** | Tạo PR có test fail *thật*, để CI chặn, rồi sửa |
| D04 | Tài liệu kiến trúc: sơ đồ tổng thể trên AWS, sơ đồ luồng dữ liệu, bảng thành phần + lý do chọn | `architecture.md` |
| D05 | Bản đặc tả ngắn: đã tích hợp chủ đề nào, giải bài toán nghiệp vụ nào | `integration-summary.md` (Phase 15) |
| D06 | Báo cáo độ phủ kiểm thử + biên bản diễn tập khôi phục | `testing-report.md`, `backup-recovery-report.md` |
| D07 | Slide 10 phút + kịch bản demo | `demo-script.md` + slide |
| D08 | Có triển khai UI web | Frontend React |

---

## 6. Những điểm SRS chưa rõ — giả định của ta

| # | Điểm chưa rõ | Giả định / đề xuất | Cần bạn xác nhận? |
|---|---|---|---|
| A1 | Nhà cung cấp AI (khoá "do lớp cấp") | **Đã chốt: Anthropic Claude.** Adapter `anthropic` + `mock` (cho test/CI) | Đã xác nhận |
| A2 | "Đồng bộ tồn kho với đối tác" — đối tác nào? | Giả lập **API đối tác** (HTTP mock service nội bộ) để có lỗi/timeout thật mà retry xử lý | Không |
| A3 | Thanh toán | Không có cổng thanh toán thật (SRS nói "định hướng tương lai"). Dùng COD + "thanh toán giả lập" để có trạng thái `UNPAID/PAID` cho job nhắc thanh toán | Không |
| A4 | "Gửi mã xác thực" | OTP xác minh email / quên mật khẩu | Không |
| A5 | "Đơn khuyến mãi" | Mã khuyến mãi giới hạn số lượt | Không |
| A6 | "Báo cáo doanh thu hằng đêm" gửi cho ai | Lưu DB + email tới các tài khoản `ADMIN` lúc 23:00 giờ VN | Không |
| A7 | Một kho hay nhiều kho | **Một kho** (tồn kho là cột `stock` của sản phẩm + bảng lịch sử biến động) | Không |
| A8 | Domain + AWS | Cần bạn tự có. Nếu chưa có, ta chuẩn bị script + hướng dẫn, không bịa URL | **Có** |
