#!/usr/bin/env bash
# KHÔI PHỤC PostgreSQL từ bản sao lưu (quy trình sự cố — xem docs/backup-recovery-report.md).
#   ./infra/backup/restore.sh backups/shopfast-<stamp>.dump
#   ./infra/backup/restore.sh s3://<bucket>/postgres/shopfast-<stamp>.dump
#   ./infra/backup/restore.sh latest          (bản mới nhất trên S3, hoặc cục bộ nếu không có S3)
#
# Các bước: tải + kiểm checksum → dừng API & worker (không cho ghi dữ liệu dở dang) → tạo lại DB
# trống → pg_restore → migrate (bổ sung nếu bản sao lưu cũ hơn code) → bật lại → health check.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/deploy/lib.sh
SRC="${1:?File .dump, s3://… hoặc latest}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
START=$(date +%s)
mkdir -p "$BACKUP_DIR"

if [ "$SRC" = "latest" ]; then
  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    KEY="$(aws s3 ls "s3://$BACKUP_S3_BUCKET/postgres/" | awk '{print $4}' | grep '\.dump$' | sort | tail -n1)"
    SRC="s3://$BACKUP_S3_BUCKET/postgres/$KEY"
  else
    SRC="$(find "$BACKUP_DIR" -name 'shopfast-*.dump' -type f | sort | tail -n1)"
  fi
  [ -n "$SRC" ] || { log "❌ Không tìm thấy bản sao lưu nào"; exit 1; }
fi
if [[ "$SRC" == s3://* ]]; then
  log "Tải $SRC…"
  aws s3 cp --only-show-errors "$SRC" "$BACKUP_DIR/"
  aws s3 cp --only-show-errors "$SRC.sha256" "$BACKUP_DIR/"
  SRC="$BACKUP_DIR/$(basename "$SRC")"
fi

log "Kiểm tra checksum $SRC"
( cd "$(dirname "$SRC")" && sha256sum -c "$(basename "$SRC").sha256" >/dev/null ) \
  || { log "❌ Checksum sai — dừng, KHÔNG khôi phục file hỏng"; exit 1; }

ACTIVE="$(state_get ACTIVE_COLOR)"
log "Dừng API + worker (ngừng ghi dữ liệu)"
compose stop api-blue api-green worker >/dev/null 2>&1 || true

compose up -d postgres redis >/dev/null
until compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d postgres' >/dev/null 2>&1; do sleep 1; done

log "Tạo lại database trống và khôi phục"
compose exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" \
    -c "CREATE DATABASE \"$POSTGRES_DB\";"'
compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$SRC"

log "Áp migration còn thiếu (nếu bản sao lưu cũ hơn code hiện tại)"
compose run --rm migrate >/dev/null

if [ -n "$ACTIVE" ]; then
  compose up -d --no-deps "api-$ACTIVE" worker >/dev/null
  wait_ready "$ACTIVE"
  # Container có thể được TẠO LẠI (IP mới) → ghi lại upstream + reload để Nginx phân giải lại
  point_nginx_to "$ACTIVE"
  public_check_retry || { log "❌ Ứng dụng chưa phản hồi qua Nginx"; exit 1; }
fi

log "✅ Khôi phục xong sau $(( $(date +%s) - START ))s"
