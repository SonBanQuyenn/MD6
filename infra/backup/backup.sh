#!/usr/bin/env bash
# SAO LƯU PostgreSQL hằng ngày (F07.4, NFR-REL-03).
#   ./infra/backup/backup.sh
# Biến môi trường:
#   BACKUP_DIR         thư mục lưu tạm trên máy (mặc định backups/)
#   BACKUP_S3_BUCKET   bucket S3 (tách biệt khỏi máy chủ ứng dụng). Bỏ trống → chỉ lưu cục bộ.
#   LOCAL_KEEP_DAYS    giữ bản cục bộ bao nhiêu ngày (mặc định 3 — bản lâu dài nằm ở S3)
#
# Định dạng: pg_dump "custom" (-Fc): nén sẵn, khôi phục chọn lọc được, kèm file .sha256 để
# phát hiện file hỏng / bị sửa trước khi khôi phục.
# Chạy hằng ngày bằng cron (xem infra/backup/README.md). pg_dump chụp một bản nhất quán
# (snapshot trong transaction) mà KHÔNG khoá bảng → API vẫn phục vụ bình thường.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/deploy/lib.sh

BACKUP_DIR="${BACKUP_DIR:-backups}"
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-3}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/shopfast-$STAMP.dump"
START=$(date +%s)

log "Sao lưu → $FILE"
# Chạy pg_dump BÊN TRONG container postgres (không cần mở cổng DB ra ngoài)
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' > "$FILE.tmp"
[ -s "$FILE.tmp" ] || { log "❌ File sao lưu rỗng"; rm -f "$FILE.tmp"; exit 1; }
mv "$FILE.tmp" "$FILE"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )
SIZE="$(du -h "$FILE" | cut -f1)"
log "✅ Đã tạo bản sao lưu $SIZE sau $(( $(date +%s) - START ))s"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  # Mã hoá phía server (SSE-S3); bucket chặn public access + versioning — xem infra/aws/
  aws s3 cp --only-show-errors --sse AES256 "$FILE" "s3://$BACKUP_S3_BUCKET/postgres/"
  aws s3 cp --only-show-errors --sse AES256 "$FILE.sha256" "s3://$BACKUP_S3_BUCKET/postgres/"
  log "✅ Đã tải lên s3://$BACKUP_S3_BUCKET/postgres/$(basename "$FILE")"
else
  log "⚠️  BACKUP_S3_BUCKET chưa đặt — bản sao lưu CHỈ nằm trên máy này (chưa tách biệt)"
fi

# Giữ bản cục bộ ngắn hạn; S3 lifecycle quản lý thời gian giữ dài hạn
find "$BACKUP_DIR" -name 'shopfast-*.dump*' -type f -mtime +"$LOCAL_KEEP_DAYS" -delete
echo "$FILE"
