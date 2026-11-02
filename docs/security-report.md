# Báo cáo bảo mật — ShopFast

> Cập nhật 2026-11-02. Phân biệt rõ: ✅ **đã hiện thực & kiểm chứng**, 📋 **đã chuẩn bị cấu hình, chưa
> chạy trên AWS**, ⚠️ **giới hạn / rủi ro đã chấp nhận**.

## 1. Xác thực & phiên đăng nhập

| Biện pháp | Chi tiết | Trạng thái |
|---|---|---|
| Băm mật khẩu | bcrypt (`bcryptjs`) cost 12, salt ngẫu nhiên; tối đa 72 ký tự (giới hạn của bcrypt) | ✅ unit test |
| Chống dò email qua thời gian phản hồi | Email không tồn tại vẫn chạy bcrypt với hash giả | ✅ |
| Access token | JWT HS256, 15 phút, secret ≥ 32 ký tự (kiểm tra khi khởi động), chỉ chấp nhận `alg=HS256` | ✅ |
| Refresh token | Ngẫu nhiên, **chỉ lưu hash SHA-256** trong DB; cookie `httpOnly` + `SameSite=Strict` + `Path=/api/auth` + `Secure` (production) | ✅ integration test |
| Xoay vòng + phát hiện đánh cắp | Mỗi lần refresh cấp token mới; dùng lại token đã thu hồi → **thu hồi mọi phiên** của tài khoản | ✅ integration test |
| Frontend | Access token chỉ trong bộ nhớ (không `localStorage`) → XSS khó lấy token lâu dài | ✅ |
| Đặt lại mật khẩu | OTP 6 số (`crypto.randomInt`), lưu **HMAC**, hết hạn 10 phút, sai 5 lần → huỷ; đổi mật khẩu → đăng xuất mọi thiết bị | ✅ unit + integration |

## 2. Phân quyền

- Guard toàn cục: `RateLimitGuard` → `JwtAuthGuard` (mặc định **mọi route cần đăng nhập**, trừ `@Public`)
  → `RolesGuard` (`@Roles(...)`). ✅ test 401 / 403 cho từng nhóm API.
- Kiểm tra **quyền sở hữu** ở tầng service (đơn hàng, ticket): tài nguyên của người khác trả **404 thay
  vì 403** → không dò được id. ✅
- Đăng ký luôn là CUSTOMER; `ValidationPipe({ whitelist, forbidNonWhitelisted })` → gửi `role` lạ = 400. ✅
- Admin không tự đổi vai trò / tự khoá chính mình. ✅
- WebSocket: JWT kiểm **lúc bắt tay**; mỗi `order:subscribe` kiểm chủ đơn; phát sự kiện chỉ vào phòng của
  đơn. Token gửi trong `auth` (không cookie) → không bị cross-site WebSocket hijacking. ✅ integration test.

## 3. Chống lạm dụng (F03)

| Biện pháp | Trạng thái |
|---|---|
| Hạn mức chung 100 req/phút/định danh (tài khoản nếu có JWT hợp lệ, ngược lại IP), lưu Redis dùng chung | ✅ |
| Hạn mức chặt: đăng nhập 5/phút/IP, OTP 3/15 phút, đơn khuyến mãi 3/phút/tài khoản | ✅ integration test |
| Khoá leo thang theo **tài khoản mục tiêu** (đổi IP không lách được): 5/10/15 lần sai → 1/15/60 phút | ✅ |
| IP thật sau Nginx: Nginx **ghi đè** `X-Forwarded-For = $remote_addr`, app `TRUST_PROXY=1` → khách không giả IP được | ✅ |
| Idempotency-Key cho đặt đơn → bấm nhiều lần / mạng gửi lại không tạo đơn trùng | ✅ test đồng thời |

⚠️ **Đánh đổi đã biết:** kẻ xấu có thể cố ý nhập sai để **khoá tạm** tài khoản người khác. Giảm thiểu:
khoá ngắn, có hạn, đăng nhập đúng xoá bộ đếm, log cảnh báo. ⚠️ Redis hỏng → hạn mức chung **fail-open**
(ưu tiên phục vụ); riêng chống dò mật khẩu có bộ đếm dự phòng trong bộ nhớ.

## 4. Dữ liệu đầu vào & đầu ra

- Mọi DTO có `class-validator`; Prisma dùng truy vấn tham số hoá (không nối chuỗi SQL). Code chạy thật
  chỉ có 1 câu `$queryRaw` (advisory lock trong `orders.repository.ts`) viết dạng *tagged template* →
  Prisma vẫn tham số hoá. `$executeRawUnsafe` chỉ có trong test (`TRUNCATE`), có chốt chỉ chạy trên DB
  tên `*_test`. ✅
- Email HTML: mọi dữ liệu người dùng qua `escapeHtml`. ✅
- Nginx: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `server_tokens off`, HSTS 1 năm (khi HTTPS). ✅ cấu hình, 📋 HTTPS chờ tên miền.
- ⚠️ Chưa có Content-Security-Policy (frontend Mantine dùng style inline) — hướng nâng cấp: CSP với nonce.

## 5. Trợ lý AI (F01)

| Rủi ro | Biện pháp | Trạng thái |
|---|---|---|
| AI tự ý thay đổi dữ liệu | **Không có tool ghi trực tiếp**; `propose_cancel_order` chỉ tạo đề xuất; nhân viên duyệt → `OrdersService` kiểm tra nghiệp vụ lại; claim có điều kiện chống duyệt 2 lần | ✅ integration test |
| AI bịa thông tin | Prompt + **guardrail phía server**: mã đơn / số tồn trong câu trả lời phải có trong dữ liệu tool | ✅ unit test |
| Prompt injection từ nội dung khách | Nội dung khách bọc `<ticket>` + prompt nói rõ là dữ liệu; lớp chặn thật là "không có quyền ghi" ở trên | ✅ / ⚠️ không chặn tuyệt đối được câu chữ |
| Lộ API key | Key chỉ ở backend (biến môi trường / SSM); frontend không gọi LLM | ✅ |
| Rò dữ liệu khách khác | Tool trả `belongsToTicketCustomer`; khách không xem được hội thoại nội bộ | ✅ |
| Chi phí / vòng lặp | Tối đa 5 vòng tool; timeout 20 s; thử lại 2 lần | ✅ |

## 6. Bí mật (secret) — NFR-SEC-04

- `.env`, `.env.prod` trong `.gitignore`; repo chỉ có file mẫu với giá trị `change-me`. ✅
- **gitleaks** quét toàn bộ lịch sử git ở mỗi PR (job `secret-scan`): 88 commit, không có secret thật. ✅
- CI tạo secret ngẫu nhiên cho mỗi lần diễn tập (`openssl rand`), không lưu lại. ✅
- Production: secret trong **SSM Parameter Store (SecureString, KMS)** → `fetch-env.sh` tạo `.env.prod`
  quyền 600. Không secret nào trong Dockerfile / workflow. 📋

## 7. Hạ tầng (NFR-SEC-02/03/05)

| Biện pháp | Trạng thái |
|---|---|
| Chỉ Nginx mở cổng 80/443; PostgreSQL & Redis **không có `ports:`** trong compose production; Redis có mật khẩu | ✅ đã dựng & diễn tập |
| Container API chạy bằng user `node` (uid 1000), `tini`, giới hạn bộ nhớ | ✅ |
| Security Group: 80/443 công khai, 22 chỉ IP quản trị (hoặc chỉ dùng SSM Session Manager) | 📋 |
| **Không khoá dài hạn:** GitHub Actions dùng OIDC → AssumeRole (credential tạm ~1 h); EC2 dùng Instance Role | 📋 `cd.yml`, `infra/aws/*.json` |
| IAM tối thiểu: role CI chỉ push 2 repo ECR + gửi lệnh SSM tới máy tag `App=shopfast`; role EC2 chỉ pull ECR, đọc `/shopfast/prod/*`, ghi/đọc `postgres/*` trong bucket backup | 📋 |
| Tài khoản AWS: root chỉ để bật MFA; người dùng qua nhóm, MFA bắt buộc | 📋 hướng dẫn trong deployment-guide |
| Bản sao lưu: S3 versioning, chặn public, bắt buộc TLS, **chỉ admin được xoá** | 📋 |

## 8. Thư viện có lỗ hổng đã biết (`npm audit --omit=dev`, 2026-11-02)

| Phần | Kết quả | Xử lý |
|---|---|---|
| Frontend | 3 high → **2 moderate** sau `npm audit fix` (react-router: open redirect qua `<Link>` có dấu `\`) | ⚠️ App chỉ dùng đường dẫn nội bộ cố định, không điều hướng theo URL do người dùng nhập |
| Backend | **17** (6 high, 11 moderate) — `body-parser`, `multer`, `js-yaml`, `lodash`, `nodemailer`, `qs`, `file-type` qua các gói `@nestjs/*` | ⚠️ Bản vá chỉ có ở **NestJS 12** (major) — SRS bắt buộc NestJS 10 nên chưa nâng. Đánh giá ảnh hưởng: không có endpoint upload (multer không được dùng); `js-yaml`/`lodash` chỉ dùng khi sinh tài liệu Swagger từ code của ta; nodemailer chỉ gửi tới email lấy từ DB. Kế hoạch: nâng NestJS sau buổi bảo vệ |

## 9. Việc còn lại trước khi chạy thật

1. Bật branch protection (CI đỏ chặn merge).
2. Tạo hạ tầng AWS theo `deployment-guide.md` (SG, OIDC, Instance Role, SSM, S3) và kiểm tra lại các mục 📋.
3. Đặt `COOKIE_SECURE=true` (mặc định khi production) và tên miền HTTPS.
4. Đổi toàn bộ secret mẫu; `SWAGGER_ENABLED=false` nếu không muốn công khai tài liệu API.
