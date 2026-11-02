# syntax=docker/dockerfile:1.7
# Frontend: build bằng Node, chạy bằng Nginx (không cần Node khi chạy).
# Khi deploy, script lấy thư mục /usr/share/nginx/html từ image này đặt vào Nginx chính
# (xem infra/deploy/deploy.sh); image cũng tự chạy độc lập được để thử nhanh.

FROM node:20.18.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM nginx:1.27.3-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# SPA: mọi đường dẫn không phải file → index.html (React Router xử lý)
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
