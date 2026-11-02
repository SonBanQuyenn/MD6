#!/usr/bin/env bash
# Tạo .env.prod từ AWS SSM Parameter Store, đường dẫn /shopfast/prod/<TÊN_BIẾN>.
# Secret KHÔNG nằm trong git, Dockerfile hay workflow (NFR-SEC-04) — chỉ ở SSM (mã hoá KMS)
# và trong file .env.prod trên máy chủ (chmod 600).
set -euo pipefail
REGION="${1:?region}"
PREFIX="${SSM_PREFIX:-/shopfast/prod/}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

aws ssm get-parameters-by-path --region "$REGION" --path "$PREFIX" --with-decryption \
  --recursive --query 'Parameters[*].[Name,Value]' --output text |
while IFS=$'\t' read -r name value; do
  printf '%s=%s\n' "${name#"$PREFIX"}" "$value"
done > "$TMP"

[ -s "$TMP" ] || { echo "Không đọc được tham số nào dưới $PREFIX"; exit 1; }
install -m 600 "$TMP" .env.prod
echo "Đã tạo .env.prod ($(wc -l < .env.prod) biến) từ SSM $PREFIX"
