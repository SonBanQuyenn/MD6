#!/usr/bin/env bash
# DIỄN TẬP deploy (chạy trong CI và cục bộ) — chứng minh bằng số đo thật:
#   1. Deploy lần đầu (v1)
#   2. Deploy v2 trong khi liên tục gọi API → đếm request lỗi (kỳ vọng 0 → không gián đoạn, NFR-REL-01)
#   3. Deploy image HỎNG → health check chặn, người dùng vẫn ở v2 (NFR-REL-02)
#   4. Rollback v2 → v1, đo thời gian (kỳ vọng < 120 s, NFR-REL-02)
# Yêu cầu: image local/shopfast-api:{v1,v2} và local/shopfast-web:{v1,v2} đã được build/tag.
set -euo pipefail
cd "$(dirname "$0")/../.."
export SKIP_PULL=1 REGISTRY=local DRAIN_SECONDS="${DRAIN_SECONDS:-3}"
HOST="${PUBLIC_HOST:-127.0.0.1}"
REPORT="${REPORT:-deploy-state/rehearsal-report.md}"
log() { printf '\n=== %s ===\n' "$*"; }
version() { curl -fs "http://$HOST/api/health/ready" >/dev/null && grep -E '^CURRENT_TAG=' deploy-state/release.env | cut -d= -f2; }

log "0. Dọn trạng thái cũ (bắt đầu như máy mới)"
docker compose -f docker-compose.prod.yml --env-file "${ENV_FILE:-.env.prod}" down -v --remove-orphans >/dev/null 2>&1 || true
rm -rf deploy-state/release.env deploy-state/www deploy-state/nginx-upstream

log "1. Deploy v1"
./infra/deploy/deploy.sh v1
[ "$(version)" = "v1" ]

log "2. Deploy v2 dưới tải (đếm request lỗi)"
: > /tmp/probe.log
( while true; do
    # /api/health/ready: đi qua Nginx → API → PostgreSQL nhưng không bị rate limit (khác /api/products)
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$HOST/api/health/ready" || echo 000)
    echo "$code" >> /tmp/probe.log
    sleep 0.05
  done ) &
PROBE=$!
T0=$(date +%s)
./infra/deploy/deploy.sh v2
DEPLOY_SECONDS=$(( $(date +%s) - T0 ))
sleep 2
kill "$PROBE"; wait "$PROBE" 2>/dev/null || true
TOTAL=$(wc -l < /tmp/probe.log)
FAILED=$(grep -vc '^200$' /tmp/probe.log || true)
echo "Request trong lúc deploy: $TOTAL, lỗi: $FAILED — phân bố mã HTTP:"
sort /tmp/probe.log | uniq -c
[ "$(version)" = "v2" ]

log "3. Deploy image hỏng (container thoát ngay khi khởi động)"
printf 'FROM local/shopfast-api:v2\nCMD ["node","-e","process.exit(1)"]\n' | docker build -q -t local/shopfast-api:broken - >/dev/null
docker tag local/shopfast-web:v2 local/shopfast-web:broken
if READY_TIMEOUT=20 ./infra/deploy/deploy.sh broken; then
  echo "❌ Deploy bản hỏng lẽ ra phải thất bại"; exit 1
fi
[ "$(version)" = "v2" ] && echo "✅ Bản hỏng bị chặn, người dùng vẫn ở v2"

log "4. Rollback v2 → v1"
T1=$(date +%s)
./infra/deploy/rollback.sh
ROLLBACK_SECONDS=$(( $(date +%s) - T1 ))
[ "$(version)" = "v1" ]

mkdir -p "$(dirname "$REPORT")"
cat > "$REPORT" <<EOF
### Diễn tập deploy blue/green

| Bước | Kết quả |
|---|---|
| Deploy v1 (lần đầu) | ✅ |
| Deploy v2 dưới tải | ✅ ${DEPLOY_SECONDS}s — ${TOTAL} request, **${FAILED} lỗi** |
| Deploy image hỏng | ✅ bị health check chặn, vẫn phục vụ v2 |
| Rollback v2 → v1 | ✅ **${ROLLBACK_SECONDS}s** (yêu cầu < 120s) |
EOF
cat "$REPORT"
[ "$FAILED" -eq 0 ] || { echo "❌ Có request lỗi trong lúc deploy"; exit 1; }
[ "$ROLLBACK_SECONDS" -lt 120 ]
