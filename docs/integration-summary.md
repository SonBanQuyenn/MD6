# Bản đặc tả ngắn — Các chủ đề Module 6 đã tích hợp vào ShopFast

> Sản phẩm bàn giao **D05**. Rubric yêu cầu tối thiểu 5 chủ đề, mỗi chủ đề giải quyết một bài toán
> nghiệp vụ rõ ràng. ShopFast tích hợp **8 chủ đề**; cột "Bằng chứng" trỏ tới thứ chạy / đo được thật.

| # | Chủ đề (Session) | Bài toán nghiệp vụ của ShopFast | Giải pháp | Bằng chứng |
|---|---|---|---|---|
| 1 | **AI Agent** (S01) | CSKH mất thời gian mở nhiều màn hình để tra đơn / tồn kho; ticket phải phân loại tay | Ticket tự phân loại ở worker; trợ lý AI (Claude tool use) tra **dữ liệu thật** qua 2 tool; thao tác ghi (huỷ đơn) chỉ là **đề xuất chờ người duyệt**; guardrail chặn câu trả lời bịa | `support.e2e-spec.ts` (10 test), `support.spec.ts` (30 test); UI `/staff/support/:id` |
| 2 | **Realtime** (S02) | Khách liên tục tải lại trang / gọi tổng đài hỏi "đơn tới đâu rồi" | Socket.IO: xác thực lúc bắt tay, phòng riêng mỗi đơn, Redis adapter, client tự kết nối lại + đăng ký lại | `realtime.e2e-spec.ts`; độ trễ đo **15–37 ms**; smoke UI: kho đổi trạng thái → trang khách đổi ngay |
| 3 | **Rate limiting** (S03) | Bot săn mã khuyến mãi, dò mật khẩu, spam gửi mã OTP | Hạn mức chung + riêng theo tài khoản / IP trên Redis; 429 tiếng Việt + Retry-After; khoá leo thang theo tài khoản mục tiêu | `rate-limit.e2e-spec.ts`; đổi IP vẫn bị khoá |
| 4 | **Caching** (S04) | Trang sản phẩm / danh mục bị gọi nhiều nhất, DB quá tải giờ cao điểm | Cache-aside Redis, chỉ cache id cho danh sách, version key, chống dồn dập (lock) + chống dò khoá (null cache), Redis hỏng vẫn chạy | k6: **p95 8,5 ms / 16,5 ms, hit 99,4 %**; `cache.e2e-spec.ts` |
| 5 | **Background jobs** (S05) | Đặt đơn chậm vì chờ gửi email / xuất hoá đơn; email trùng; quên nhắc thanh toán | BullMQ + worker riêng, outbox giao dịch, retry + backoff, dead letter, **đúng 1 email / đơn**, job hẹn 30 phút + báo cáo hằng đêm | `jobs.e2e-spec.ts`; trang `/admin/queues` |
| 6 | **Container hoá** (S06) | "Chạy trên máy em được" — khác biệt môi trường dev / server | Dockerfile multi-stage (non-root, healthcheck), compose dev + production (DB/Redis không mở cổng) | `docker-compose.prod.yml`; diễn tập dựng stack production |
| 7 | **CI/CD** (S07) | Deploy tay dễ lỗi, gián đoạn khách; lỗi lọt vào nhánh chính | CI: lint, format, unit + **ngưỡng coverage**, integration (PG + Redis thật), gitleaks, **diễn tập deploy + khôi phục**; CD: OIDC → ECR → SSM, blue/green, tự rollback | Deploy dưới tải **0 request lỗi**; rollback **5–7 s**; PR #15 bị CI chặn thật |
| 8 | **Triển khai cloud & vận hành** (S07, S08) | Cần chạy 24/7, an toàn, có sao lưu & giám sát | Health / readiness, Swagger, dashboard hàng đợi & cache; sao lưu hằng ngày + kiểm tra + khôi phục; cấu hình AWS tối thiểu quyền | Khôi phục sau khi **xoá volume DB: 9 s, dữ liệu khớp 100 %**. ⚠️ Phần AWS đã chuẩn bị, **chưa triển khai** |

## Luồng nghiệp vụ xuyên suốt (một đơn hàng chạm vào 6 chủ đề)

1. Khách xem sản phẩm → **cache** trả trong vài ms.
2. Đặt đơn (giới hạn tần suất với đơn khuyến mãi → **rate limit**) → transaction trừ kho chống bán vượt.
3. Email xác nhận, hoá đơn, đồng bộ kho chạy **nền** (khách không chờ).
4. Kho chuyển "Đang giao" → khách thấy ngay (**realtime**).
5. Khách hỏi "bao giờ tới" → CSKH hỏi **trợ lý AI**, AI tra trạng thái thật; khách muốn huỷ → AI đề xuất,
   nhân viên duyệt.
6. Toàn bộ chạy trong **container**, lên bản mới bằng **CI/CD blue/green** không gián đoạn.
