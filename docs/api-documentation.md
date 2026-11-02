# Tài liệu API — ShopFast

> Nguồn chuẩn, luôn khớp code: **Swagger UI `/api/docs`**, OpenAPI JSON `/api/docs-json` (sinh tự động
> từ controller + DTO). Tài liệu này tóm tắt quy ước chung và quyền truy cập: **62 endpoint** REST +
> 1 kênh WebSocket.

## 1. Quy ước chung

| Mục | Quy ước |
|---|---|
| Đường dẫn gốc | `/api` (Nginx chuyển `/api/*` tới backend, phần còn lại là frontend) |
| Định dạng | JSON UTF-8; tiền là **số nguyên VND**; thời gian ISO 8601 (UTC) |
| Xác thực | `Authorization: Bearer <accessToken>` (JWT HS256, 15 phút) |
| Refresh | Cookie `sf_refresh` (httpOnly, `SameSite=Strict`, `Path=/api/auth`, 7 ngày) — **xoay vòng** mỗi lần dùng; dùng lại token cũ → thu hồi mọi phiên |
| Phân trang | `?page=1&limit=20` (limit ≤ 50) → `{ items, page, limit, total, totalPages }` |
| Lỗi | `{ statusCode, message, error }` — `message` tiếng Việt; lỗi validation là mảng thông điệp |
| Rate limit | Header `X-RateLimit-Limit`, `X-RateLimit-Remaining`; vượt → **429** + `Retry-After` + `{ retryAfter }` |
| Idempotency | `POST /orders`, `/orders/promotional` **bắt buộc** `Idempotency-Key` (8–100 ký tự). Gửi lại cùng key → 200 + `Idempotent-Replayed: true`, trả đơn cũ |
| Cache | Đọc sản phẩm / danh mục / thương hiệu trả header `X-Cache: HIT \| MISS \| BYPASS` |

### Mã lỗi thường gặp

| Mã | Khi nào |
|---|---|
| 400 | Dữ liệu sai (validation), thiếu Idempotency-Key, mã OTP sai |
| 401 | Thiếu / sai / hết hạn access token; sai mật khẩu |
| 403 | Đúng người nhưng sai vai trò; tài khoản bị khoá |
| 404 | Không tồn tại **hoặc không thuộc về bạn** (không phân biệt — chống dò id) |
| 409 | Xung đột nghiệp vụ: hết hàng, đổi trạng thái sai luật, trùng slug/email, đề xuất AI đã xử lý |
| 429 | Vượt hạn mức tần suất / tài khoản tạm khoá do dò mật khẩu |
| 503 | `/health` có thành phần hỏng; trợ lý AI tạm không khả dụng |

## 2. Danh sách endpoint theo quyền

Ký hiệu quyền: **Công khai** · **KH** = CUSTOMER · **CS** = SUPPORT_AGENT · **Kho** = WAREHOUSE_STAFF · **AD** = ADMIN.

### Xác thực & người dùng

| Method | Đường dẫn | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/auth/register` | Công khai | Luôn tạo CUSTOMER (gửi `role` → 400) |
| POST | `/auth/login` | Công khai | 5 lần/phút/IP; sai 5/10/15 lần → khoá tài khoản 1/15/60 phút |
| POST | `/auth/refresh` · `/auth/logout` | Cookie | |
| POST | `/auth/verification-code` | Công khai | 3 lần/15 phút; luôn 202 (không lộ email có tồn tại) |
| POST | `/auth/verify-email` · `/auth/reset-password` | Công khai | Mã 6 số, 10 phút, sai 5 lần → huỷ mã |
| GET | `/users/me` | Đã đăng nhập | |
| GET · PATCH | `/users`, `/users/:id/role`, `/users/:id/status` | AD | Không tự đổi vai trò / khoá chính mình |

### Danh mục sản phẩm

| Method | Đường dẫn | Quyền |
|---|---|---|
| GET | `/products` (`categoryId, brandId, minPrice, maxPrice, q, sort, page, limit`), `/products/:id`, `/categories`, `/brands` | Công khai (có cache) |
| POST · PATCH · DELETE | `/products`, `/categories`, `/brands` (+ `/:id`) | AD |

### Giỏ hàng, đơn hàng, tồn kho, khuyến mãi

| Method | Đường dẫn | Quyền |
|---|---|---|
| GET · POST · PATCH · DELETE | `/cart`, `/cart/items`, `/cart/items/:productId` | KH |
| POST | `/orders`, `/orders/promotional` (3 lần/phút) | KH |
| GET | `/orders/me` | KH |
| GET | `/orders/:id`, `/orders/:id/invoice` | Chủ đơn hoặc CS / Kho / AD |
| POST | `/orders/:id/cancel` (chỉ khi PENDING), `/orders/:id/pay` (giả lập) | KH (chủ đơn) |
| GET | `/orders` | CS, Kho, AD |
| PATCH | `/orders/:id/status` | Kho, AD — theo máy trạng thái |
| POST · GET | `/inventory/adjustments`, `/inventory/low-stock`, `/inventory/products/:id/movements` | Kho, AD |
| GET · POST | `/promotions` | AD |

### Hỗ trợ & trợ lý AI

| Method | Đường dẫn | Quyền |
|---|---|---|
| POST · GET | `/support/tickets`, `/support/tickets/me` | KH |
| GET | `/support/tickets` (`status, category`) | CS, AD |
| GET · POST | `/support/tickets/:id`, `/support/tickets/:id/messages` | Chủ ticket hoặc CS / AD (khách không thấy tin nội bộ) |
| PATCH | `/support/tickets/:id` (`status`, `category` → HUMAN) | CS, AD |
| POST | `/support/tickets/:id/assistant` `{ question }` | CS, AD |
| POST | `/support/actions/:id/approve` · `/reject` | CS, AD |

### Quản trị & giám sát

| Method | Đường dẫn | Quyền |
|---|---|---|
| GET | `/health`, `/health/ready`, `/health/live` | Công khai (không bị rate limit) |
| GET | `/admin/queues`, `/admin/jobs/failed` · POST `/admin/jobs/failed/:id/retry` | AD |
| GET · POST | `/admin/reports/daily-revenue` | AD |
| GET · DELETE | `/admin/metrics/cache` | AD |

## 3. WebSocket — theo dõi đơn (Socket.IO)

| Mục | Giá trị |
|---|---|
| Đường dẫn | `/api/socket.io` (cùng domain, qua Nginx) |
| Xác thực | `io({ path: '/api/socket.io', auth: { token } })` — kiểm JWT **lúc bắt tay**; sai → `connect_error: UNAUTHORIZED` |
| Đăng ký | `emitWithAck('order:subscribe', { orderId })` → `{ ok: true, status }` hoặc `{ ok: false, error: 'FORBIDDEN' \| 'INVALID' }` |
| Sự kiện | `order:status` → `{ orderId, code, status, statusLabel, paymentStatus, note, at }` |
| Quyền | Khách: chỉ đơn của mình. CS / Kho / AD: mọi đơn |
| Kết nối lại | Client phải gửi lại `order:subscribe` ở MỖI lần `connect` và tải lại đơn qua REST |

## 4. Ví dụ nhanh (curl)

```bash
# Đăng nhập (lưu cookie refresh)
curl -c jar -H 'Content-Type: application/json' \
  -d '{"email":"customer@shopfast.local","password":"<SEED_PASSWORD>"}' \
  http://localhost:3000/api/auth/login
# → { "accessToken": "eyJ…", "user": { … } }

# Đặt đơn (giỏ hàng đã có sản phẩm)
curl -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"COD","shippingAddress":{"fullName":"Nguyễn Văn A","phone":"0912345678","addressLine":"1 Lê Lợi","city":"Hà Nội"}}' \
  http://localhost:3000/api/orders
```
