#!/usr/bin/env bash
# Deploy BLUE/GREEN không gián đoạn (NFR-REL-01, NFR-REL-02, TD-11).
#
#   ./infra/deploy/deploy.sh <tag>        vd: ./infra/deploy/deploy.sh 3f2a9c1e…(commit SHA)
#
# Biến môi trường:
#   REGISTRY   nơi chứa image (ECR: <account>.dkr.ecr.<region>.amazonaws.com). Mặc định "local".
#   SKIP_PULL  =1 khi image đã có sẵn trên máy (diễn tập cục bộ / CI) → không docker pull.
#
# Các bước — hỏng ở bước nào thì DỪNG, người dùng vẫn ở bản cũ:
#   1. Kéo image mới (tag = commit SHA, cố định → biết chính xác đang chạy code nào)
#   2. Chạy migration (tương thích ngược: bản cũ vẫn chạy được trên schema mới)
#   3. Dựng API màu "rảnh" với image mới, chờ /api/health/ready
#   4. Chép frontend mới, chuyển Nginx sang màu mới (reload êm), kiểm tra lại QUA Nginx
#      → hỏng: tự quay lui về màu cũ + frontend cũ
#   5. Cập nhật worker, dừng màu cũ (giữ container để rollback nhanh)
set -euo pipefail
cd "$(dirname "$0")/../.."
source infra/deploy/lib.sh

TAG="${1:?Thiếu tag image (commit SHA)}"
REGISTRY="${REGISTRY:-local}"
API_IMAGE="$REGISTRY/shopfast-api:$TAG"
WEB_IMAGE="$REGISTRY/shopfast-web:$TAG"
START=$(date +%s)

# Không cho 2 lần deploy chạy chồng lên nhau
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { log "Đang có lần deploy khác chạy"; exit 1; }

ACTIVE="$(state_get ACTIVE_COLOR)"
TARGET="$( [ -n "$ACTIVE" ] && other_color "$ACTIVE" || echo blue )"
PREV_TAG="$(state_get CURRENT_TAG)"
log "Deploy $TAG — đang chạy: ${ACTIVE:-<chưa có>} ($PREV_TAG) → dựng: $TARGET"

# 1. Image
if [ "${SKIP_PULL:-0}" != "1" ]; then
  log "Kéo image…"
  docker pull -q "$API_IMAGE"
  docker pull -q "$WEB_IMAGE"
fi

# 2. Hạ tầng + migration
compose up -d postgres redis mailpit
state_set MIGRATE_IMAGE "$API_IMAGE"
log "Chạy migration…"
compose run --rm migrate

# 3. API màu mới. Ghi nhớ image cũ của màu này: deploy hỏng thì trả lại, để rollback sau đó
#    không khởi động nhầm image hỏng.
TARGET_KEY="API_IMAGE_$(echo "$TARGET" | tr a-z A-Z)"
TARGET_OLD_IMAGE="$(state_get "$TARGET_KEY")"
restore_target() {
  compose stop "api-$TARGET" || true
  if [ -n "$TARGET_OLD_IMAGE" ]; then state_set "$TARGET_KEY" "$TARGET_OLD_IMAGE"; fi
}
state_set "$TARGET_KEY" "$API_IMAGE"
compose up -d --no-deps --force-recreate "api-$TARGET"
if ! wait_ready "$TARGET"; then
  restore_target
  log "❌ Deploy thất bại ở bước health check — người dùng VẪN dùng bản cũ (${ACTIVE:-không có})"
  exit 1
fi

# 4. Frontend + chuyển traffic
if [ ! -d "$WWW_DIR/$TAG" ]; then
  cid="$(docker create "$WEB_IMAGE")"
  docker cp "$cid:/usr/share/nginx/html" "$WWW_DIR/$TAG.tmp"
  docker rm "$cid" >/dev/null
  mv "$WWW_DIR/$TAG.tmp" "$WWW_DIR/$TAG"
fi
PREV_WWW="$(readlink "$WWW_DIR/current" 2>/dev/null || true)"
point_www_to "$TAG"
point_nginx_to "$TARGET"

if ! public_check_retry; then
  log "❌ Kiểm tra sau deploy (qua Nginx) thất bại → QUAY LUI"
  if [ -n "$ACTIVE" ]; then
    point_nginx_to "$ACTIVE"
    [ -n "$PREV_WWW" ] && point_www_to "$PREV_WWW"
  fi
  restore_target
  log "Đã quay lui về $ACTIVE ($PREV_TAG) sau $(( $(date +%s) - START ))s"
  exit 1
fi

# 5. Worker + dọn màu cũ
state_set WORKER_IMAGE "$API_IMAGE"
compose up -d --no-deps worker
if [ -n "$ACTIVE" ]; then
  sleep "${DRAIN_SECONDS:-10}" # chờ request đang xử lý ở màu cũ hoàn tất
  compose stop "api-$ACTIVE"
fi

state_set ACTIVE_COLOR "$TARGET"
state_set PREVIOUS_TAG "$PREV_TAG"
state_set PREVIOUS_WWW "$PREV_WWW"
state_set CURRENT_TAG "$TAG"

# Giữ 3 bản frontend gần nhất
mapfile -t OLD_RELEASES < <(find "$WWW_DIR" -mindepth 1 -maxdepth 1 -type d ! -name 'current*'   -printf '%T@ %f
' | sort -rn | tail -n +4 | cut -d' ' -f2-)
for release in "${OLD_RELEASES[@]}"; do rm -rf "${WWW_DIR:?}/$release"; done

log "✅ Deploy $TAG thành công trên api-$TARGET sau $(( $(date +%s) - START ))s"
