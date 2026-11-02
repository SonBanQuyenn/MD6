#!/usr/bin/env bash
# QUAY LUI về bản chạy tốt gần nhất (NFR-REL-02: < 2 phút).
#   ./infra/deploy/rollback.sh
# Nhanh vì KHÔNG phải kéo / build gì: container màu cũ và frontend cũ vẫn còn trên máy,
# chỉ cần khởi động lại màu cũ, chờ sẵn sàng rồi trỏ Nginx về.
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/deploy/lib.sh
START=$(date +%s)

exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { log "Đang có lần deploy khác chạy"; exit 1; }

ACTIVE="$(state_get ACTIVE_COLOR)"
PREV_TAG="$(state_get PREVIOUS_TAG)"
PREV_WWW="$(state_get PREVIOUS_WWW)"
[ -n "$ACTIVE" ] && [ -n "$PREV_TAG" ] || { log "Không có bản trước để quay lui"; exit 1; }
TARGET="$(other_color "$ACTIVE")"
CUR_TAG="$(state_get CURRENT_TAG)"

log "Quay lui: $CUR_TAG (api-$ACTIVE) → $PREV_TAG (api-$TARGET)"
compose up -d --no-deps "api-$TARGET" # image cũ vẫn ghi trong release.env
wait_ready "$TARGET"
[ -n "$PREV_WWW" ] && point_www_to "$PREV_WWW"
point_nginx_to "$TARGET"
public_check_retry || { log "❌ Bản cũ cũng không phản hồi qua Nginx — cần xử lý tay"; exit 1; }

state_set WORKER_IMAGE "$(state_get "API_IMAGE_$(echo "$TARGET" | tr a-z A-Z)")"
compose up -d --no-deps worker
compose stop "api-$ACTIVE"

state_set ACTIVE_COLOR "$TARGET"
state_set CURRENT_TAG "$PREV_TAG"
state_set PREVIOUS_TAG "$CUR_TAG"
state_set PREVIOUS_WWW "$CUR_TAG"

log "✅ Đã quay lui về $PREV_TAG sau $(( $(date +%s) - START ))s"
