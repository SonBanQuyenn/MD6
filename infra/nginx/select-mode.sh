#!/bin/sh
# Chạy tự động khi container Nginx khởi động (/docker-entrypoint.d/).
# Có chứng chỉ cho $DOMAIN → dùng https.conf; chưa có → http-only.conf (để certbot lấy chứng chỉ).
set -eu

CONF=/etc/nginx/conf.d/default.conf
CERT="/etc/letsencrypt/live/${DOMAIN:-none}/fullchain.pem"

if [ -n "${DOMAIN:-}" ] && [ -f "$CERT" ]; then
  # Chỉ thay biến ${DOMAIN}, giữ nguyên các biến của Nginx như $host, $request_uri
  envsubst '${DOMAIN}' < /etc/nginx/templates/https.conf > "$CONF"
  echo "[select-mode] HTTPS cho ${DOMAIN}"
else
  cp /etc/nginx/templates/http-only.conf "$CONF"
  echo "[select-mode] Chưa có chứng chỉ → chạy HTTP (chế độ khởi đầu)"
fi

# Lần chạy đầu (chưa deploy lần nào): trỏ upstream tới api-blue
if [ ! -f /etc/nginx/upstream/active.conf ]; then
  echo 'upstream api_upstream { zone api_upstream 64k; server api-blue:3000 resolve; keepalive 16; }' > /etc/nginx/upstream/active.conf
fi
