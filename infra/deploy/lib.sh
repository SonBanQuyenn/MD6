#!/usr/bin/env bash
# Hàm dùng chung cho deploy.sh / rollback.sh. Chạy từ thư mục gốc repo trên server.
set -euo pipefail

STATE_DIR="${STATE_DIR:-deploy-state}"
RELEASE_FILE="$STATE_DIR/release.env"
UPSTREAM_FILE="$STATE_DIR/nginx-upstream/active.conf"
WWW_DIR="$STATE_DIR/www"
ENV_FILE="${ENV_FILE:-.env.prod}"
READY_TIMEOUT="${READY_TIMEOUT:-90}" # giây chờ bản mới sẵn sàng
# Địa chỉ để kiểm tra "từ phía người dùng" qua Nginx. Trên EC2 là chính máy đó (127.0.0.1).
PUBLIC_HOST="${PUBLIC_HOST:-127.0.0.1}"

mkdir -p "$STATE_DIR/nginx-upstream" "$WWW_DIR" "$STATE_DIR/certbot/www" "$STATE_DIR/certbot/conf"
touch "$RELEASE_FILE"

compose() {
  docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" --env-file "$RELEASE_FILE" "$@"
}

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# Đọc 1 khoá trong release.env (rỗng nếu chưa có)
state_get() { grep -E "^$1=" "$RELEASE_FILE" | tail -n1 | cut -d= -f2- || true; }

# Ghi / thay 1 khoá trong release.env
state_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^$key=" "$RELEASE_FILE" > "$tmp" || true
  echo "$key=$value" >> "$tmp"
  mv "$tmp" "$RELEASE_FILE"
}

other_color() { [ "$1" = "blue" ] && echo green || echo blue; }

# Chờ API ở màu $1 trả 200 cho /api/health/ready (gọi TỪ BÊN TRONG container → không phụ thuộc Nginx)
wait_ready() {
  local color="$1" waited=0
  log "Chờ api-$color sẵn sàng (tối đa ${READY_TIMEOUT}s)…"
  until compose exec -T "api-$color" node -e \
    "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; do
    sleep 3
    waited=$((waited + 3))
    if [ "$waited" -ge "$READY_TIMEOUT" ]; then
      log "❌ api-$color không sẵn sàng sau ${READY_TIMEOUT}s"
      compose logs --tail 30 "api-$color" || true
      return 1
    fi
  done
  log "✅ api-$color sẵn sàng sau ~${waited}s"
}

# Trỏ Nginx tới màu $1 và reload "êm" (kết nối đang mở không bị cắt)
point_nginx_to() {
  local color="$1"
  echo "upstream api_upstream { server api-$color:3000; keepalive 16; }" > "$UPSTREAM_FILE.tmp"
  mv "$UPSTREAM_FILE.tmp" "$UPSTREAM_FILE"
  if compose ps --status running nginx | grep -q nginx; then
    compose exec -T nginx nginx -t >/dev/null 2>&1
    compose exec -T nginx nginx -s reload
  else
    compose up -d nginx
  fi
  log "Nginx → api-$color"
}

# Trỏ frontend tới phiên bản $1 (symlink tương đối để dùng được bên trong container Nginx)
point_www_to() {
  ln -sfn "$1" "$WWW_DIR/current.tmp"
  mv -T "$WWW_DIR/current.tmp" "$WWW_DIR/current"
  log "Frontend → $1"
}

# Kiểm tra từ phía người dùng: đi QUA Nginx (HTTPS nếu đã có chứng chỉ)
public_check() {
  local domain url
  domain="$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d= -f2- || true)"
  if [ -n "$domain" ] && [ -f "$STATE_DIR/certbot/conf/live/$domain/fullchain.pem" ]; then
    url="https://$PUBLIC_HOST/api/health/ready"
    curl -fsk --max-time 5 -H "Host: $domain" "$url" >/dev/null
  else
    url="http://$PUBLIC_HOST/api/health/ready"
    curl -fs --max-time 5 "$url" >/dev/null
  fi
}

public_check_retry() {
  for _ in 1 2 3 4 5; do
    public_check && return 0
    sleep 2
  done
  return 1
}
