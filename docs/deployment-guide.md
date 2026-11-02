# Hướng dẫn triển khai — ShopFast

> Trạng thái (2026-11-02): **Docker + CI/CD đã sẵn sàng và đã diễn tập thật** (cục bộ + CI).
> **Chưa triển khai lên AWS** — các bước ở mục 4 là việc của Phase 13, chỉ làm khi bạn có tài khoản
> AWS + tên miền và đồng ý triển khai. Tài liệu này không chứa URL / tài khoản AWS bịa đặt.

## 1. Kiến trúc chạy thật (1 máy EC2)

```
Internet ──443/80──► Nginx ──► api-blue  ┐ (chỉ 1 màu nhận traffic)
                       │  └──► api-green ┘
                       └─ frontend tĩnh (deploy-state/www/<sha>, symlink "current")
          mạng nội bộ Docker "backend": PostgreSQL · Redis · worker · Mailpit  (KHÔNG mở cổng)
```

| Thành phần | Image | Ghi chú |
|---|---|---|
| API (blue / green) | `shopfast-api:<commit-sha>` | Multi-stage, Node 20 bookworm-slim, user `node` (không root), `tini`, HEALTHCHECK `/api/health/live`, giới hạn 512 MB |
| Worker | cùng image API, lệnh `node dist/worker.js` | `stop_grace_period: 30s` để làm xong job |
| Migration | cùng image API, `prisma migrate deploy` | Chạy trước khi chuyển traffic; migration phải tương thích ngược |
| Frontend | `shopfast-web:<commit-sha>` | Build bằng Node, chạy bằng Nginx; khi deploy chỉ lấy thư mục tĩnh |
| Nginx | `nginx:1.27.3-alpine` + cấu hình `infra/nginx` | Tự chọn HTTPS (có chứng chỉ) / HTTP (chưa có); `X-Forwarded-For = $remote_addr` |
| PostgreSQL / Redis | `postgres:16.6-alpine`, `redis:7.4-alpine` | Volume bền vững; Redis có mật khẩu + AOF |

Tag image luôn là **commit SHA** (không dùng `latest`) → biết chính xác đang chạy code nào, quay lui
bằng cách chạy lại tag cũ (NFR-QUA-03).

## 2. Quy trình deploy blue/green (`infra/deploy/deploy.sh <sha>`)

1. Kéo image `<sha>` (API + web).
2. Bật PostgreSQL / Redis nếu chưa chạy, chạy **migration**.
3. Dựng API ở **màu rảnh** với image mới → chờ `/api/health/ready` (tối đa 90 s).
   Hỏng → dừng màu mới, **khôi phục cấu hình image cũ của màu đó**, người dùng vẫn ở bản cũ.
4. Chép frontend mới, đổi symlink, ghi lại upstream Nginx → `nginx -s reload` (kết nối đang mở không bị
   cắt) → **kiểm tra lại qua Nginx**. Hỏng → tự trỏ Nginx + frontend về bản cũ.
5. Cập nhật worker, chờ 10 s cho request cũ xong, **dừng** (không xoá) màu cũ để rollback nhanh.

`infra/deploy/rollback.sh`: khởi động lại màu cũ (image cũ vẫn trên máy) → chờ sẵn sàng → trỏ Nginx +
frontend về → dừng màu hiện tại. Không phải kéo / build gì.

### Kết quả diễn tập thật (`infra/deploy/rehearsal.sh`)

Chạy trên Docker Desktop (Windows 11) ngày 2026-11-02, và tự động trong CI (job `deploy-rehearsal`):

| Bước | Kết quả đo |
|---|---|
| Deploy v1 lần đầu | ✅ ~8–16 s |
| Deploy v2 trong khi liên tục gọi `/api/health/ready` qua Nginx | ✅ 13–16 s — **228 và 243 request, 0 lỗi** (2 lần chạy) |
| Deploy image hỏng (container thoát ngay) | ✅ bị chặn ở health check, vẫn phục vụ v2 |
| Rollback v2 → v1 | ✅ **6 s và 7 s** (yêu cầu < 2 phút) |

Giới hạn trung thực: v1 và v2 trong diễn tập là **cùng một bản build** gắn 2 tag (kiểm tra cơ chế
chuyển, không phải khác biệt code). Diễn tập lần đầu đã phát hiện 1 lỗi thật (deploy hỏng để lại
image hỏng trong cấu hình → rollback sau đó thất bại) — đã sửa trong `deploy.sh` (`restore_target`).

Chạy lại diễn tập trên máy Linux có Docker:

```bash
docker build -t local/shopfast-api:v1 backend && docker tag local/shopfast-api:v1 local/shopfast-api:v2
docker build -t local/shopfast-web:v1 frontend && docker tag local/shopfast-web:v1 local/shopfast-web:v2
cp .env.prod.example .env.prod   # đổi change-me, đặt COOKIE_SECURE=false khi chạy HTTP
bash infra/deploy/rehearsal.sh
```

(Trên Windows: chạy bên trong container `docker:27-cli` có mount Docker socket, đặt
`PUBLIC_HOST=host.docker.internal` — cách đã dùng để đo số liệu trên.)

## 3. Pipeline

| Workflow | Khi nào | Làm gì |
|---|---|---|
| `ci.yml` | Mọi PR, push `develop`/`main` | secret-scan, lint, format, unit + ngưỡng coverage, integration (PG + Redis thật), build frontend, **diễn tập deploy** |
| `cd.yml` | Sau CI xanh trên `main` / chạy tay | Build + push image (tag SHA) lên ECR → deploy qua SSM → health check qua Internet → **tự rollback** nếu hỏng. Chạy tay `action=rollback` để quay lui |

`cd.yml` **đang tắt** (chỉ chạy khi repo variable `DEPLOY_ENABLED=true`).

## 4. Việc cần làm khi lên AWS (Phase 13 — chưa thực hiện)

Theo thứ tự; mọi giá trị `<…>` do bạn cung cấp, không có giá trị mặc định bịa sẵn.

1. **Tài khoản & IAM người dùng:** đăng nhập root chỉ để bật MFA rồi khoá lại; tạo nhóm `admins` (MFA bắt
   buộc), người dùng IAM thuộc nhóm (không gắn quyền trực tiếp cho user).
2. **ECR:** tạo 2 repository `shopfast-api`, `shopfast-web` (bật *scan on push*, lifecycle giữ 10 image).
3. **GitHub OIDC:** tạo OIDC provider `token.actions.githubusercontent.com`; role `shopfast-github-deploy`
   với trust policy `infra/aws/github-oidc-trust-policy.json` và quyền `infra/aws/github-deploy-policy.json`
   (chỉ push 2 repo ECR + gửi lệnh SSM tới máy gắn tag `App=shopfast`).
4. **EC2:** Amazon Linux 2023, `t3.small` (2 GB) + swap 2 GB, tag `App=shopfast`, Instance Role gồm
   `AmazonSSMManagedInstanceCore` + `infra/aws/ec2-instance-policy.json` (pull 2 repo ECR, đọc
   `/shopfast/prod/*`). Cài Docker + compose plugin + git, clone repo vào `/opt/shopfast`.
5. **Security Group:** inbound 80, 443 từ `0.0.0.0/0`; 22 **chỉ từ IP quản trị** `<YOUR_IP>/32` (hoặc
   bỏ hẳn 22, dùng SSM Session Manager). Không mở 5432 / 6379.
6. **Secret:** tạo SecureString trong SSM Parameter Store dưới `/shopfast/prod/` cho từng biến trong
   `.env.prod.example` (`fetch-env.sh` tạo `.env.prod` quyền 600 trên máy).
7. **Tên miền + HTTPS:** trỏ bản ghi A về Elastic IP; deploy lần đầu (Nginx chạy HTTP); lấy chứng chỉ:
   `docker compose -f docker-compose.prod.yml --profile tools run --rm certbot certonly --webroot -w /var/www/certbot -d <DOMAIN>`
   rồi `docker compose … restart nginx` → tự chuyển sang HTTPS + chuyển hướng 80 → 443. Gia hạn: cron
   `certbot renew` + `nginx -s reload` 2 lần / ngày.
8. **GitHub:** repo Variables `DEPLOY_ENABLED=true`, `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `DOMAIN`;
   environment `production` (tuỳ chọn *Required reviewers*).
9. Bật **AWS Budgets** cảnh báo chi phí.
