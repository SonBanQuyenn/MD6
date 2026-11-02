#!/usr/bin/env bash
# KIỂM TRA bản sao lưu có khôi phục được không — khôi phục vào một PostgreSQL TẠM (container riêng,
# không đụng DB thật), đếm số dòng các bảng chính. "Bản sao lưu chưa từng khôi phục thử = chưa có".
#   ./infra/backup/verify.sh backups/shopfast-<stamp>.dump
set -euo pipefail
FILE="${1:?Đường dẫn file .dump}"
NAME="shopfast-verify-$$"
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null ) \
  || { log "❌ Checksum sai — file sao lưu hỏng hoặc bị sửa"; exit 1; }

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify \
  postgres:16.6-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT
# Image postgres khởi tạo bằng 1 server tạm rồi KHỞI ĐỘNG LẠI → chờ init xong hẳn mới kết nối
until docker logs "$NAME" 2>&1 | grep -q 'PostgreSQL init process complete'; do sleep 1; done
until docker exec "$NAME" pg_isready -U postgres -d verify >/dev/null 2>&1; do sleep 1; done

docker exec -i "$NAME" pg_restore -U postgres -d verify --no-owner --exit-on-error < "$FILE"

# Mỗi dòng: tên_bảng|số_dòng — để so sánh với DB nguồn / lần khôi phục thật
docker exec "$NAME" psql -U postgres -d verify -At -c "
  SELECT 'users|' || count(*) FROM users UNION ALL
  SELECT 'products|' || count(*) FROM products UNION ALL
  SELECT 'orders|' || count(*) FROM orders UNION ALL
  SELECT 'order_items|' || count(*) FROM order_items UNION ALL
  SELECT 'tickets|' || count(*) FROM tickets UNION ALL
  SELECT 'migrations|' || count(*) FROM _prisma_migrations"
log "✅ Bản sao lưu khôi phục được"
