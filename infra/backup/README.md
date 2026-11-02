# Sao lưu & khôi phục PostgreSQL

| Script | Việc |
|---|---|
| `backup.sh` | `pg_dump -Fc` (nén, nhất quán, không khoá bảng) + `.sha256` → `backups/` → S3 (nếu đặt `BACKUP_S3_BUCKET`), xoá bản cục bộ cũ hơn `LOCAL_KEEP_DAYS` (3) ngày |
| `verify.sh <file>` | Khôi phục thử vào PostgreSQL TẠM (container riêng) → đếm dòng các bảng chính |
| `restore.sh <file \| s3://… \| latest>` | Kiểm checksum → dừng API + worker → tạo lại DB → `pg_restore` → migrate → bật lại → health check |
| `drill.sh` | Diễn tập đầy đủ: dữ liệu thật → sao lưu → kiểm tra → **xoá volume DB** → khôi phục → so sánh + đo thời gian |

## Lịch chạy trên EC2 (cron của `ec2-user`)

```cron
# EC2 dùng giờ UTC: 19:00 UTC = 02:00 giờ Việt Nam (ít khách nhất)
0 19 * * * cd /opt/shopfast && BACKUP_S3_BUCKET=<BACKUP_BUCKET> ./infra/backup/backup.sh >> /var/log/shopfast/backup.log 2>&1 && ./infra/backup/verify.sh "$(ls -1 backups/*.dump | tail -n1)" >> /var/log/shopfast/backup.log 2>&1
```

Sao lưu xong là **kiểm tra ngay** bằng `verify.sh` — bản sao lưu chưa khôi phục thử coi như chưa có.

## Lưu trữ tách biệt (S3)

- Bucket riêng `<BACKUP_BUCKET>`, chặn public access, **bật versioning**, mã hoá SSE.
- `infra/aws/backup-bucket-lifecycle.json`: sau 7 ngày chuyển STANDARD_IA (rẻ hơn), **giữ 35 ngày** rồi xoá.
- `infra/aws/backup-bucket-policy.json`: từ chối truy cập không qua TLS; **chỉ role quản trị được xoá**
  bản sao lưu (máy EC2 bị chiếm quyền cũng không xoá được bản sao lưu).
- Role của EC2 chỉ có `PutObject` / `GetObject` / `ListBucket` trên tiền tố `postgres/`.

| Chỉ số | Giá trị |
|---|---|
| RPO (dữ liệu tối đa có thể mất) | 24 giờ (sao lưu hằng ngày) |
| RTO mục tiêu (SRS) | < 30 phút |
| Thời gian giữ | 3 ngày trên máy, 35 ngày trên S3 |
