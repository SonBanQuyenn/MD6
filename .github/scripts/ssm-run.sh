#!/usr/bin/env bash
# Gửi 1 lệnh tới EC2 (gắn tag App=shopfast) qua AWS SSM Run Command, chờ xong, in log, trả mã lỗi.
# Không cần SSH / mở cổng 22 cho GitHub Actions.
set -euo pipefail
COMMAND="$1"
REGION="${AWS_REGION:?}"

CMD_ID="$(aws ssm send-command --region "$REGION" \
  --document-name AWS-RunShellScript \
  --targets Key=tag:App,Values=shopfast \
  --comment "ShopFast CD ${GITHUB_RUN_ID:-manual}" \
  --timeout-seconds 900 \
  --parameters "commands=[\"sudo -iu ec2-user bash -lc 'cd /opt/shopfast && $COMMAND'\"]" \
  --query 'Command.CommandId' --output text)"
echo "SSM command: $CMD_ID"

INSTANCE="$(aws ssm list-command-invocations --region "$REGION" --command-id "$CMD_ID" \
  --query 'CommandInvocations[0].InstanceId' --output text)"
for _ in $(seq 1 15); do
  [ "$INSTANCE" != "None" ] && [ -n "$INSTANCE" ] && break
  sleep 2
  INSTANCE="$(aws ssm list-command-invocations --region "$REGION" --command-id "$CMD_ID" \
    --query 'CommandInvocations[0].InstanceId' --output text)"
done

# Chờ lệnh chạy xong (deploy thường < 2 phút; giới hạn 15 phút)
for _ in $(seq 1 180); do
  STATUS="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" \
    --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in Pending|InProgress|Delayed) sleep 5 ;; *) break ;; esac
done

aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text
echo "Kết quả: $STATUS"
[ "$STATUS" = "Success" ]
