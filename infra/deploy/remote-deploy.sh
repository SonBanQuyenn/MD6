#!/usr/bin/env bash
# Chạy TRÊN EC2, được GitHub Actions gọi qua AWS SSM Run Command (không SSH, không khoá dài hạn).
#   ./infra/deploy/remote-deploy.sh deploy <commit-sha>
#   ./infra/deploy/remote-deploy.sh rollback
# Máy EC2 dùng IAM Instance Role (thông tin xác thực tạm thời, tự xoay vòng) để:
#   đọc secret từ SSM Parameter Store, kéo image từ ECR.
set -euo pipefail
cd "$(dirname "$0")/../.."

ACTION="${1:?deploy|rollback}"
REGION="${AWS_REGION:-$(curl -fs -H "X-aws-ec2-metadata-token: $(curl -fs -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/placement/region)}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

# Lấy đúng phiên bản script / cấu hình Nginx của commit sắp deploy (repo public, chỉ đọc)
if [ "$ACTION" = "deploy" ]; then
  SHA="${2:?Thiếu commit SHA}"
  git fetch --quiet --depth 1 origin "$SHA"
  git checkout --quiet --detach FETCH_HEAD
fi

# Secret: SSM Parameter Store (SecureString, mã hoá KMS) → .env.prod (quyền 600, chỉ chủ sở hữu đọc)
./infra/deploy/fetch-env.sh "$REGION"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

case "$ACTION" in
  deploy) ./infra/deploy/deploy.sh "$SHA" ;;
  rollback) ./infra/deploy/rollback.sh ;;
  *) echo "Hành động không hợp lệ: $ACTION"; exit 1 ;;
esac
