# Báo cáo sao lưu & khôi phục — ShopFast

> Biên bản diễn tập dưới đây là **số đo thật** chạy bằng `infra/backup/drill.sh` ngày 2026-11-02 trên
> stack production (`docker-compose.prod.yml`, image production) dựng bằng Docker Desktop.
> Diễn tập tương tự chạy tự động trong CI (job `deploy-rehearsal`, bước *Recovery drill*).
> **Chưa diễn tập trên AWS** (chưa có hạ tầng) — phần S3 ở mục 5 là cấu hình đã chuẩn bị, chưa đo.

## 1. Chiến lược

| Hạng mục | Lựa chọn | Lý do |
|---|---|---|
| Công cụ | `pg_dump -Fc` (custom format) | Bản chụp nhất quán trong 1 transaction, **không khoá bảng** (API vẫn phục vụ); nén sẵn; `pg_restore` khôi phục chọn lọc được |
| Tần suất | Hằng ngày 02:00 giờ VN (cron) | SRS F07.4; giờ ít khách nhất |
| Toàn vẹn | File `.sha256` đi kèm; `restore.sh` từ chối file sai checksum | Không khôi phục file hỏng / bị sửa |
| Kiểm tra | `verify.sh` khôi phục thử vào PostgreSQL tạm sau MỖI lần sao lưu | "Bản sao lưu chưa khôi phục thử = chưa có bản sao lưu" |
| Lưu trữ tách biệt | S3 bucket riêng (versioning, chặn public, SSE, cấm xoá trừ admin) | Máy EC2 hỏng / bị xoá / bị chiếm quyền vẫn còn bản sao lưu |
| Thời gian giữ | 3 ngày trên máy, **35 ngày** trên S3 (sau 7 ngày chuyển STANDARD_IA) | Đủ quay về trước sự cố phát hiện muộn; chi phí thấp |
| RPO | ≤ 24 giờ | Sao lưu hằng ngày (đánh đổi đã biết — xem mục 6) |
| RTO mục tiêu | < 30 phút | NFR-REL-03 |

## 2. Quy trình khôi phục (khi có sự cố)

1. Xác định sự cố là **mất / hỏng dữ liệu** (không phải lỗi code → khi đó dùng `rollback.sh`).
2. Chọn bản sao lưu: `latest`, hoặc bản trước thời điểm dữ liệu hỏng (`aws s3 ls s3://<bucket>/postgres/`).
3. Chạy `./infra/backup/restore.sh <bản sao lưu>` trên EC2. Script tự: kiểm checksum → dừng API +
   worker → tạo lại DB trống → `pg_restore` → áp migration còn thiếu → bật lại → health check qua Nginx.
4. Kiểm tra nghiệp vụ: đăng nhập, xem đơn gần nhất, `GET /api/health`.
5. Ghi nhận: dữ liệu từ thời điểm sao lưu tới lúc sự cố (tối đa 24 h) bị mất → đối soát với email xác
   nhận đơn (Mailpit / nhà cung cấp email) và log để nhập bù nếu cần.

## 3. Biên bản diễn tập — 2026-11-02 14:08 UTC

**Dữ liệu trước sự cố:** seed (4 tài khoản, 10 danh mục, 21 thương hiệu, 500 sản phẩm) + **3 đơn hàng
và 1 ticket tạo qua API thật** (đăng nhập khách → giỏ → đặt đơn với Idempotency-Key → gửi ticket).

**Sự cố giả lập:** xoá container PostgreSQL **và volume dữ liệu** (`compose rm -sfv postgres` +
`docker volume rm`) → khởi động PostgreSQL trống: bảng `users` không còn tồn tại.

| Bảng | Trước sự cố | Bản sao lưu (khôi phục thử) | Sau khôi phục |
|---|---|---|---|
| users | 4 | 4 | 4 |
| products | 500 | 500 | 500 |
| orders | 3 | 3 | 3 |
| order_items | 3 | 3 | 3 |
| tickets | 1 | 1 | 1 |
| _prisma_migrations | 7 | 7 | 7 |

| Chỉ số | Kết quả |
|---|---|
| Kích thước bản sao lưu | 88 KB |
| Thời gian sao lưu | < 1 s |
| Kiểm tra bản sao lưu (khôi phục thử vào DB tạm) | ✅ khớp DB nguồn |
| **Thời gian khôi phục (RTO đo được)** | **9 s** — mục tiêu < 30 phút |
| Dữ liệu sau khôi phục | ✅ khớp 100 % |
| Kiểm tra qua ứng dụng | ✅ khách đăng nhập lại, thấy đủ 3 đơn hàng; `api-blue` sẵn sàng sau ~3 s |

Nhật ký các bước khôi phục (trích):

```
[14:08:42] Kiểm tra checksum backups/shopfast-20261102T140835Z.dump
[14:08:42] Dừng API + worker (ngừng ghi dữ liệu)
[14:08:43] Tạo lại database trống và khôi phục
[14:08:43] Áp migration còn thiếu (nếu bản sao lưu cũ hơn code hiện tại)
[14:08:51] ✅ api-blue sẵn sàng sau ~3s
[14:08:51] ✅ Khôi phục xong sau 9s
```

Diễn tập cũng phát hiện và đã sửa 1 lỗi trong `verify.sh`: image PostgreSQL khởi động 1 server tạm để
init rồi khởi động lại → `pg_isready` báo sẵn sàng quá sớm → `pg_restore` hỏng. Đã sửa bằng cách chờ log
"init process complete".

## 4. Đánh giá trung thực về RTO

- 9 s là với **dữ liệu nhỏ** (88 KB). `pg_restore` tăng gần tuyến tính theo kích thước: ước tính với
  dữ liệu thật của 200.000 khách cỡ vài GB vẫn ở mức vài phút trên `t3.small` — **cần đo lại** khi có
  dữ liệu thật.
- Trên AWS còn cộng thời gian **tải bản sao lưu từ S3** (cùng region, thường vài giây đến vài chục giây
  cho vài trăm MB) và thời gian người trực **phát hiện + quyết định** (không đo được bằng script).
- Kết luận: mục tiêu < 30 phút có biên an toàn rất lớn ở quy mô hiện tại; chỉ tiêu đã **đo thật cục bộ**,
  chưa đo trên EC2.

## 5. Cấu hình đã chuẩn bị cho AWS (chưa chạy)

| File | Nội dung |
|---|---|
| `infra/aws/backup-bucket-lifecycle.json` | STANDARD_IA sau 7 ngày, xoá sau 35 ngày, phiên bản cũ xoá sau 7 ngày |
| `infra/aws/backup-bucket-policy.json` | Từ chối truy cập không TLS; chỉ role quản trị được xoá bản sao lưu |
| `infra/aws/ec2-instance-policy.json` | Role EC2: chỉ `PutObject` / `GetObject` / `ListBucket` trên `postgres/*` |
| `infra/backup/README.md` | Dòng cron hằng ngày (sao lưu + kiểm tra) |

## 6. Giới hạn đã biết

- **RPO 24 giờ:** sự cố lúc 01:59 có thể mất gần 1 ngày đơn hàng. Hướng nâng cấp: WAL archiving
  (point-in-time recovery) hoặc chuyển sang Amazon RDS (backup tự động + PITR 5 phút).
- Sao lưu và DB cùng nằm trên 1 EC2 cho tới khi tải lên S3 — nếu `BACKUP_S3_BUCKET` chưa đặt, script
  cảnh báo rõ "chưa tách biệt".
- Redis không được sao lưu: chỉ chứa cache, bộ đếm rate limit và hàng đợi; job chưa xử lý có bản ghi
  `job_outbox` trong PostgreSQL để đẩy lại (TD-10).
