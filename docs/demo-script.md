# Kịch bản demo — buổi bảo vệ (10 phút trình bày + 5 phút hỏi đáp)

> Mục tiêu: chứng minh **hệ thống chạy thật** và **mỗi chủ đề giải quyết một bài toán**, không đọc slide.
> Trọng số rubric: chạy thật 25 % · tích hợp 25 % · tự động hoá deploy 20 % · bảo mật & vận hành 15 % ·
> mã & tài liệu 15 % · **giải thích quyết định = điều kiện bắt buộc**.

## 0. Chuẩn bị (trước buổi bảo vệ 30 phút)

- [ ] `https://<DOMAIN>` mở được, ổ khoá HTTPS xanh; `https://<DOMAIN>/api/health` → `ok`.
      *(Chưa có AWS → chạy cục bộ: `docker compose up -d`, backend + worker + `npm run dev`.)*
- [ ] Seed dữ liệu demo; kiểm tra 4 tài khoản đăng nhập được (mật khẩu = `SEED_PASSWORD`).
- [ ] Nếu dùng Claude thật: `AI_PROVIDER=anthropic`, gọi thử 1 câu (tránh lỗi key lúc demo).
- [ ] Mở sẵn các tab: (1) trình duyệt **khách** (cửa sổ thường), (2) trình duyệt **kho** (ẩn danh),
      (3) trình duyệt **CSKH** (profile khác), (4) GitHub Actions, (5) Swagger `/api/docs`,
      (6) `docs/` trong repo.
- [ ] Một commit nhỏ đã chuẩn bị sẵn (ví dụ đổi chữ trên trang chủ) để demo deploy.
- [ ] Tắt thông báo máy tính; zoom trình duyệt 110 %.

## 1. Mở đầu — 0:00 → 1:00

"ShopFast là backend thương mại điện tử cho ~200.000 khách. Em tích hợp 8 chủ đề, mỗi chủ đề giải quyết
một vấn đề cụ thể." → mở `docs/integration-summary.md` (1 bảng), chỉ sơ đồ kiến trúc
(`docs/architecture.md` mục 2): chỉ Nginx ra Internet, DB/Redis nằm trong mạng nội bộ.

## 2. Luồng khách hàng + cache + realtime — 1:00 → 3:30

1. Tab **khách**: trang Sản phẩm → lọc danh mục + khoảng giá. Mở DevTools → Network → request
   `/api/products` có header **`X-Cache: HIT`** (lần 2). *"Cache-aside Redis, p95 đo bằng k6 là 8,5 ms."*
2. Thêm vào giỏ → Đặt hàng → chuyển sang trang **theo dõi đơn**, badge **"Đang cập nhật trực tiếp"**.
3. Tab **kho** (`warehouse@`): Quản lý đơn → đơn vừa đặt → bấm **"→ Đã xác nhận"**, rồi "Đang đóng gói".
4. Quay lại tab khách: trạng thái đổi **ngay**, không tải lại trang. *"Socket.IO, xác thực lúc bắt tay,
   mỗi đơn một phòng — khách khác không nhận được sự kiện này."*

## 3. Tác vụ nền — 3:30 → 4:30

1. Admin → **Hàng đợi**: thấy job email / hoá đơn / đồng bộ kho vừa chạy xong.
2. Mailpit (`localhost:8025` hoặc SSH tunnel): **đúng 1 email** xác nhận cho đơn. Khách bấm "Xem hoá đơn".
3. *"Đặt đơn không chờ gửi email; job có retry + backoff; hết lượt vào dead letter, admin chạy lại được."*

## 4. Trợ lý AI cho CSKH — 4:30 → 6:00

1. Tab khách: Hỗ trợ → gửi yêu cầu "Tôi muốn huỷ đơn …" (chọn đơn).
2. Tab **CSKH** (`support@`): ticket đã có **nhóm** do AI / từ khoá phân loại.
3. Bấm gợi ý **"Kiểm tra trạng thái đơn …"** → AI trả lời kèm **kết quả tool** (mở accordion: dữ liệu DB thật).
4. Bấm gợi ý **"Khách muốn huỷ đơn …"** → xuất hiện **đề xuất chờ duyệt**; chỉ ra: đơn **chưa** bị huỷ.
5. Bấm **Duyệt** → tab khách thấy đơn chuyển "Đã huỷ" (realtime).
6. Hỏi "Thủ đô của Pháp?" → AI **từ chối lịch sự**.
   *(Nếu đang Mock: nói thẳng "đây là adapter Mock có nhãn đỏ, không phải AI thật — vì …")*

## 5. Chống lạm dụng — 6:00 → 6:45

Trang đăng nhập: nhập sai mật khẩu `customer@…` 5 lần → thông báo **"Tài khoản tạm thời bị khoá… thử lại
sau 1 phút"** (429). *"Đếm theo tài khoản mục tiêu, đổi IP cũng không lách được; Redis dùng chung cho
mọi instance."* Lưu ý: IP của máy demo cũng vừa chạm hạn mức **5 lần đăng nhập / phút** → đây là lớp
bảo vệ thứ 2 (theo IP); nói điều này rồi **đợi ~1 phút** trước khi đăng nhập lại (các tab đã đăng nhập
sẵn không bị ảnh hưởng).

## 6. CI/CD + rollback — 6:45 → 9:00

1. Push commit đã chuẩn bị lên `main` (hoặc mở GitHub Actions run gần nhất nếu mạng chậm).
2. Chỉ các job CI: lint → unit (**ngưỡng coverage 60 % mỗi service**) → integration → gitleaks →
   **deploy-rehearsal** (Job Summary: **0 request lỗi** khi deploy, rollback **5 s**).
3. Mở **PR #15**: CI **đỏ**, bị chặn merge vì unit test bắt lỗi giảm giá. *(D03)*
4. CD (khi đã có AWS): build image tag = SHA → ECR → SSM chạy `deploy.sh` → health check → trang chủ đổi
   chữ, **không rớt kết nối**. Chạy workflow `action=rollback` → quay về bản trước trong vài giây.

## 7. Vận hành & bảo mật — 9:00 → 10:00

- Admin → **Sức khoẻ hệ thống** (PostgreSQL / Redis up, tỉ lệ trúng cache) · Swagger `/api/docs`.
- `docs/backup-recovery-report.md`: xoá hẳn volume DB → khôi phục **9 s**, dữ liệu khớp 100 %.
- Bảo mật: không khoá AWS dài hạn (OIDC + Instance Role), DB/Redis không mở cổng, secret ở SSM, gitleaks.
- Kết: "Những gì chưa làm được và vì sao" (AWS / Claude thật nếu chưa có) — nói trước khi bị hỏi.

## Phương án dự phòng

| Sự cố lúc demo | Xử lý |
|---|---|
| Mạng / AWS hỏng | Chạy stack cục bộ (`docker compose -f docker-compose.prod.yml …` hoặc dev) — đã chuẩn bị sẵn |
| Claude API lỗi / hết hạn mức | Trợ lý trả 503 + thông báo → minh hoạ **suy giảm có kiểm soát**; chuyển `AI_PROVIDER=mock` |
| Realtime không cập nhật | Tải lại trang: dữ liệu vẫn đúng (REST là nguồn chuẩn); mở DevTools → WS để chẩn đoán |
| Tài khoản demo bị khoá do thử sai | Khoá tự hết hạn (lần đầu 1 phút) — dùng các tab đã đăng nhập sẵn trong lúc chờ. Nút khoá/mở ở trang Người dùng là trạng thái khác, **không** gỡ khoá chống dò mật khẩu |
