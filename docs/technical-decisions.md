# Quyết định kỹ thuật (Technical Decisions)

Mỗi quyết định ghi: **bối cảnh → lựa chọn → lý do → đánh đổi → khi sự cố thì sao**. Đây là tài
liệu chính để trả lời tiêu chí R06 "Bảo vệ quyết định kỹ thuật" (điều kiện bắt buộc).

Trạng thái: *Đề xuất* (chờ bạn duyệt ở Phase 0) · *Chấp nhận* · *Thay thế bởi TD-xx*.

---

## TD-01 — Modular monolith + tiến trình worker riêng
- **Trạng thái:** Đề xuất
- **Bối cảnh:** 1 người phát triển, 1 EC2, SRS cần API + realtime + job nền.
- **Lựa chọn:** 1 codebase NestJS, chia module theo nghiệp vụ; 2 entrypoint `main.ts` (API) và
  `worker.ts` (BullMQ), cùng 1 image.
- **Lý do:** đơn giản để hiểu, test, deploy; job nặng (email, hoá đơn, gọi AI) không chiếm CPU
  của API → giữ p95 đặt hàng < 300 ms.
- **Đánh đổi:** không scale độc lập từng nghiệp vụ như microservices — không cần ở quy mô này.
- **Khi sự cố:** worker chết → API vẫn phục vụ, job nằm chờ trong Redis, worker lên lại xử lý tiếp.

## TD-02 — Prisma thay vì TypeORM
- **Trạng thái:** Chấp nhận (2026-10-31)
- **Lựa chọn:** Prisma 5.
- **Lý do:**
  - `schema.prisma` là 1 file mô tả toàn bộ DB → dễ đọc, dễ vẽ ERD, dễ giải thích.
  - Kiểu TypeScript tự sinh → sai tên cột là lỗi biên dịch ngay.
  - Migration sinh tự động, lịch sử rõ ràng.
  - Hỗ trợ đủ thứ ta cần: `$transaction` (interactive), `updateMany` có điều kiện cho trừ kho
    nguyên tử, `$queryRaw` khi cần SQL thuần.
- **Đánh đổi:** không có decorator entity kiểu NestJS/TypeORM quen thuộc ở Module 5; `CHECK
  constraint` phải viết tay trong file migration SQL.
- Prisma chỉ nằm trong tầng Repository → nếu sau này đổi ORM, tầng Service/Controller không phải sửa.

## TD-03 — Xác thực: JWT access ngắn hạn + refresh token xoay vòng
- **Trạng thái:** Chấp nhận — hiện thực ở Phase 2 (`backend/src/auth`, `backend/src/common/guards`)
- **Lựa chọn:** access token 15 phút (gửi qua header `Authorization`), refresh token 7 ngày gửi
  qua **cookie httpOnly, Secure, SameSite=Strict**, lưu **hash SHA-256** trong DB, mỗi lần refresh
  cấp token mới và thu hồi token cũ (rotation). Phát hiện token cũ bị dùng lại → thu hồi cả chuỗi.
- **Lý do:** access token ngắn hạn giảm thiệt hại khi lộ; refresh token trong cookie httpOnly
  không đọc được bằng JavaScript (chống XSS lấy cắp); lưu hash để lộ DB không lộ token.
- **Mật khẩu:** thư viện **`bcryptjs`** (bcrypt viết bằng JavaScript thuần), cost 12. Chọn
  `bcryptjs` thay vì `bcrypt` (bản C++) để không phải biên dịch native module trong Docker Alpine/CI;
  cùng thuật toán, hash tương thích nhau, chỉ chậm hơn một chút. Mật khẩu tối đa 72 ký tự vì bcrypt
  chỉ dùng 72 byte đầu. Không bao giờ log mật khẩu / token.
- **Không dùng Passport:** guard tự viết (~40 dòng) dùng `JwtService.verifyAsync` — ít phụ thuộc,
  dễ giải thích. `JwtAuthGuard` áp **toàn cục**, endpoint công khai phải gắn `@Public()` → quên gắn
  thì endpoint bị khoá (an toàn mặc định), không bị lộ.
- **Chống dò email:** đăng nhập sai email hay sai mật khẩu đều trả cùng thông báo; khi email không
  tồn tại vẫn chạy bcrypt với hash giả để thời gian phản hồi tương đương.
- **Đăng ký** luôn tạo `CUSTOMER`; `ValidationPipe(forbidNonWhitelisted)` từ chối nếu gửi kèm `role`.
  Tài khoản nhân viên do ADMIN cấp quyền qua `PATCH /api/users/:id/role`.
- **Giới hạn đã biết:**
  - Access token không kiểm tra DB mỗi request (để nhanh) → đổi vai trò / khoá tài khoản có hiệu
    lực đầy đủ sau tối đa 15 phút (refresh token bị thu hồi ngay).
  - Hai tab cùng refresh một lúc bằng cùng cookie: một tab thắng, tab kia nhận 401 (do điều kiện
    `revokedAt IS NULL` trong transaction). Frontend (Phase 9) sẽ gom các lần refresh đồng thời
    thành một request để tránh trường hợp này.
- **Khi sự cố:** nghi lộ token → admin khoá tài khoản (`PATCH /api/users/:id/status`) → mọi refresh
  token bị thu hồi; access token còn sống tối đa 15 phút. Lộ `JWT_ACCESS_SECRET` → đổi secret và
  deploy lại: mọi access token cũ mất hiệu lực ngay.

## TD-04 — Chống bán vượt bằng UPDATE có điều kiện trong transaction
- Xem chi tiết [database-design.md §6](database-design.md#6-chống-bán-vượt--vì-sao-câu-lệnh-này-an-toàn).
- **Thay thế đã cân nhắc:** khoá phân tán Redis (phức tạp, Redis hỏng là hỏng bán hàng);
  `SELECT FOR UPDATE` (đúng nhưng dài dòng hơn); kiểm tra ở frontend (vô nghĩa về an toàn).
- **Lớp bảo vệ thứ 2:** `CHECK (stock >= 0)`.

## TD-05 — Realtime: Socket.IO + phòng riêng mỗi đơn + Redis adapter
- **Lý do:** Socket.IO có sẵn **tự kết nối lại**, **rooms**, fallback long-polling khi mạng chặn
  WebSocket; NestJS hỗ trợ gateway chính thức.
- **Bảo mật:** xác thực JWT trong middleware handshake (chặn trước khi kết nối được thiết lập);
  kiểm tra quyền sở hữu mỗi lần `order:subscribe`; **không bao giờ** dùng `server.emit` toàn cục.
- **Redis adapter:** khi blue/green có 2 instance API cùng lúc, sự kiện phát ở instance này vẫn tới
  client nối vào instance kia.
- **Khi sự cố:** client mất kết nối → reconnect với backoff → đăng ký lại → gọi REST lấy trạng thái
  mới nhất (không phụ thuộc việc không bị lỡ sự kiện).

## TD-06 — Rate limit: `@nestjs/throttler` + Redis, tracker tuỳ biến
- **Lý do:** lưu bộ đếm trong Redis để giới hạn đúng khi chạy nhiều instance (bộ nhớ trong process
  sẽ bị nhân đôi hạn mức).
- **Đề xuất hạn mức ban đầu** (sẽ điều chỉnh sau đo đạc):

  | Phạm vi | Hạn mức |
  |---|---|
  | Toàn cục | 100 request / 60 giây / định danh |
  | `POST /auth/login` | 5 / 60 giây / IP |
  | `POST /auth/verification-code` | 3 / 15 phút / định danh |
  | `POST /orders/promotional` | 3 / 60 giây / tài khoản |

- **Dò mật khẩu:** đếm lần sai theo **email mục tiêu** (không theo IP) → kẻ tấn công xoay vòng IP
  vẫn bị chặn. Khoá leo thang 1' → 15' → 60'.
- **Đánh đổi đã biết:** kẻ xấu có thể cố tình đăng nhập sai để khoá tài khoản người khác (DoS tài
  khoản). Giảm thiểu: khoá có thời hạn ngắn, không khoá vĩnh viễn, ghi log để admin theo dõi.
  Ghi rõ trong `security-report.md`.
- **Redis hỏng:** fail-open cho giới hạn chung; đăng nhập có bộ đếm in-memory dự phòng.

## TD-07 — AI: adapter interface, mặc định Claude, có Mock adapter
- **Trạng thái:** Chấp nhận (2026-10-31) — nhà cung cấp AI là **Anthropic Claude**.
- **Bối cảnh:** SRS nói "khoá truy cập dịch vụ AI được cấp trong phạm vi lớp học" nhưng không nói
  nhà cung cấp.
- **Lựa chọn:** interface `LlmProvider { chat(messages, tools): LlmResponse }` với:
  - `AnthropicProvider` — Claude, tool use (function calling).
  - `MockLlmProvider` — kịch bản cố định để chạy test/CI không tốn tiền, **ghi nhãn rõ trên UI**:
    "⚠️ MOCK AI — không phải phản hồi AI thật".
  - Chọn bằng biến môi trường `AI_PROVIDER`.
- **Vòng lặp agent tự viết** (không dùng LangChain): gửi tin → nếu model yêu cầu tool → backend
  chạy tool → gửi kết quả → lặp tối đa N lần. Ngắn (~100 dòng), bạn tự giải thích được.
- **Không bịa:** prompt quy định + guardrail kiểm tra phía server: nếu câu trả lời nhắc tới
  mã đơn/số tồn kho mà trong lượt đó không có tool call tương ứng → thay bằng thông báo an toàn.
- **Thao tác ghi:** tool ghi chỉ tạo `ai_pending_actions`; thực thi khi con người duyệt.
- **API key** chỉ ở backend (biến môi trường / SSM), frontend không bao giờ gọi LLM trực tiếp.
- **Khi sự cố:** timeout 20 s, retry 2 lần với backoff; vẫn lỗi → thông báo cho nhân viên, phân
  loại ticket dùng bộ từ khoá dự phòng.

## TD-08 — Cache-aside + version key cho danh sách
- **Chi tiết:** khoá `product:{id}` (TTL 10' ± jitter), danh sách
  `products:list:v{N}:{sha1(query chuẩn hoá)}` (TTL 5' ± jitter).
- **Vì sao version key?** Một sản phẩm đổi giá có thể nằm trong hàng nghìn tổ hợp bộ lọc; không
  thể tìm & xoá từng khoá (`KEYS *` chặn Redis). Tăng `N` → toàn bộ khoá cũ không bao giờ được
  đọc nữa và tự hết hạn theo TTL.
- **Stampede:** khoá `SET lock:{key} NX PX 3000`; người giữ khoá tải DB và ghi cache, người khác
  chờ ngắn rồi đọc lại; hết thời gian chờ thì đọc DB (không treo request).
- **Penetration:** ID không đúng định dạng UUID → 400 ngay; ID hợp lệ nhưng không tồn tại → cache
  giá trị `__NULL__` 60 giây.
- **Thứ tự:** cập nhật DB → commit → xoá cache (không xoá trước commit, tránh request khác nạp lại
  giá cũ vào cache).

## TD-09 — Frontend: React + Vite + Mantine + TanStack Query
- **Mantine 7:** component đầy đủ (bảng, form, modal, notification, AppShell responsive) → giao
  diện chuyên nghiệp mà ít CSS tự viết; có `@mantine/form` cho validate.
- **TanStack Query:** quản lý loading/error/empty state và cache phía client một cách thống nhất.
- **Phân quyền trang:** `ProtectedRoute` kiểm tra role; *backend vẫn là nơi kiểm tra quyền thật*.

## TD-10 — Job nền: BullMQ + idempotency nhiều lớp + outbox
- **Idempotency:** (1) `jobId` xác định từ nghiệp vụ (`order-confirmation:{orderId}`) → BullMQ
  bỏ qua job trùng; (2) ràng buộc `UNIQUE` trong DB là chốt chặn cuối khi job thật sự chạy lại.
- **Outbox:** trong transaction đặt đơn, ghi `job_outbox`. Sau commit, đẩy job lên BullMQ và đánh
  dấu `dispatched_at`. Một job định kỳ quét bản ghi chưa dispatch (do Redis hỏng đúng lúc đó) và
  đẩy lại. → Không mất email dù Redis chập chờn.
- **Retry:** email 5 lần, backoff exponential bắt đầu 2 s; đồng bộ kho đối tác 8 lần bắt đầu 5 s.
- **Dead letter:** lần thử cuối thất bại → bảng `failed_jobs` + queue `dead-letter`; admin xem và
  "chạy lại" từ dashboard.
- **Lịch:** nhắc thanh toán = delayed job 30 phút (chạy thì kiểm tra lại `payment_status`);
  báo cáo doanh thu = repeatable job `0 23 * * *` giờ `Asia/Ho_Chi_Minh`.

## TD-11 — Triển khai: EC2 + Docker Compose + blue/green + SSM, image trên ECR
- **Vì sao không ECS/EKS?** SRS yêu cầu EC2; Compose dễ hiểu, dễ debug trong buổi bảo vệ.
- **Blue/green trên 1 máy:** `api-blue` đang chạy → dựng `api-green` với image SHA mới → chờ
  `/health/ready` → đổi upstream Nginx → `nginx -s reload` (graceful, không rớt kết nối) → dừng
  `api-blue`. Fail ở bước nào → giữ/chuyển về màu cũ → rollback chỉ vài giây (< 2 phút yêu cầu).
- **Migration DB:** chỉ dùng migration **tương thích ngược** (expand → contract) để bản cũ và mới
  cùng chạy được trong lúc chuyển.
- **Không SSH từ CI:** GitHub Actions → OIDC → role chỉ có quyền `ecr:Push` + `ssm:SendCommand`
  trên đúng instance tag.
- **Đánh đổi:** 1 EC2 = 1 điểm lỗi đơn (single point of failure). Ghi rõ là giới hạn; hướng nâng cấp
  là ALB + Auto Scaling Group + RDS + ElastiCache.

## TD-12 — Diễn giải các nghiệp vụ SRS chưa mô tả chi tiết
- "Gửi mã xác thực" → OTP 6 số (hash trong DB, hết hạn 10', tối đa 5 lần nhập) để xác minh email /
  đặt lại mật khẩu.
- "Đơn khuyến mãi" → `POST /orders/promotional` với mã khuyến mãi giới hạn lượt dùng; trừ lượt
  dùng nguyên tử như trừ kho.
- "Đồng bộ tồn kho với đối tác" → service đối tác giả lập (có thể cấu hình tỉ lệ lỗi) để chứng minh
  retry/backoff/DLQ hoạt động thật.
- "Thanh toán" → COD + thanh toán giả lập (không có cổng thanh toán thật — SRS xếp vào tương lai).

## TD-13 — Phiên bản Node.js
- Máy bạn đang có **Node 22**; SRS yêu cầu **Node 20 LTS**. Docker image và CI dùng `node:20`,
  `package.json` khai báo `"engines": { "node": ">=20 <21" }`, có `.nvmrc`. Khuyến nghị cài
  **nvm-windows** để chạy Node 20 cục bộ cho khớp môi trường thật.
