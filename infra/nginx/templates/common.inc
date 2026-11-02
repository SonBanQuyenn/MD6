# Phần cấu hình dùng chung cho cả chế độ HTTP (chưa có chứng chỉ) và HTTPS.

root /srv/www/current;           # bản frontend đang chạy (symlink, đổi khi deploy)
index index.html;

client_max_body_size 1m;
server_tokens off;               # không lộ phiên bản Nginx

add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy strict-origin-when-cross-origin always;

gzip on;
gzip_types text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;

# WebSocket (Socket.IO — F02): giữ kết nối lâu, nâng cấp giao thức
location /api/socket.io/ {
    proxy_pass http://api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
}

# API — ghi đè X-Forwarded-For bằng IP thật kết nối tới Nginx (không nối thêm giá trị khách tự gửi)
# → backend (TRUST_PROXY=1) đọc đúng IP để rate limit (F03), khách không giả IP được.
location /api/ {
    proxy_pass http://api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}

# File build có hash trong tên → cache 1 năm; index.html luôn lấy bản mới
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable" always;
    try_files $uri =404;
}

location / {
    add_header Cache-Control "no-cache" always;
    try_files $uri /index.html;
}
