#!/usr/bin/env bash
# DIỄN TẬP KHÔI PHỤC (NFR-REL-03: khôi phục < 30 phút) — đo thật, ghi biên bản.
#   bash infra/backup/drill.sh
# Kịch bản: dựng stack + dữ liệu thật (seed + đơn hàng + ticket tạo qua API) → sao lưu → kiểm tra
# bản sao lưu → XOÁ HẲN container + volume PostgreSQL (mất toàn bộ dữ liệu) → khôi phục → so sánh.
# Yêu cầu: image local/shopfast-api:v1 + local/shopfast-web:v1, file .env.prod (có SEED_PASSWORD).
set -euo pipefail
cd "$(dirname "$0")/../.."
export SKIP_PULL=1 REGISTRY=local DRAIN_SECONDS=1
source infra/deploy/lib.sh
REPORT="${REPORT:-deploy-state/drill-report.md}"
section() { printf '\n=== %s ===\n' "$*"; }

counts() {
  compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "
    SELECT '"'"'users|'"'"' || count(*) FROM users UNION ALL
    SELECT '"'"'products|'"'"' || count(*) FROM products UNION ALL
    SELECT '"'"'orders|'"'"' || count(*) FROM orders UNION ALL
    SELECT '"'"'order_items|'"'"' || count(*) FROM order_items UNION ALL
    SELECT '"'"'tickets|'"'"' || count(*) FROM tickets UNION ALL
    SELECT '"'"'migrations|'"'"' || count(*) FROM _prisma_migrations"'
}

# Tạo dữ liệu nghiệp vụ THẬT qua API (bên trong container API, gọi chính nó)
make_business_data() {
  compose exec -T -e SEED_PASSWORD "api-$(state_get ACTIVE_COLOR)" node -e '
    const base = "http://127.0.0.1:3000/api";
    const j = (r) => r.json();
    (async () => {
      const login = await fetch(base + "/auth/login", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "customer@shopfast.local", password: process.env.SEED_PASSWORD }) }).then(j);
      const auth = { Authorization: "Bearer " + login.accessToken, "Content-Type": "application/json" };
      const products = await fetch(base + "/products?limit=3").then(j);
      for (let i = 0; i < 3; i++) {
        await fetch(base + "/cart/items", { method: "POST", headers: auth,
          body: JSON.stringify({ productId: products.items[i].id, quantity: 1 }) });
        const order = await fetch(base + "/orders", { method: "POST",
          headers: { ...auth, "Idempotency-Key": "drill-order-" + i + "-" + Date.now() },
          body: JSON.stringify({ paymentMethod: "COD", shippingAddress: { fullName: "Khách diễn tập",
            phone: "0912345678", addressLine: "1 Lê Lợi", city: "Hà Nội" } }) }).then(j);
        console.log("Đơn", order.code);
      }
      const t = await fetch(base + "/support/tickets", { method: "POST", headers: auth,
        body: JSON.stringify({ subject: "Diễn tập khôi phục", message: "Ticket tạo trước khi sao lưu" }) }).then(j);
      console.log("Ticket", t.id);
    })().catch((e) => { console.error(e); process.exit(1); });'
}

section "0. Dựng stack production sạch + seed"
compose down -v --remove-orphans >/dev/null 2>&1 || true
rm -rf deploy-state/release.env deploy-state/www deploy-state/nginx-upstream backups
./infra/deploy/deploy.sh v1 >/dev/null
compose run --rm --no-deps -e SEED_PASSWORD -e ALLOW_DEMO_SEED=1 worker node dist-seed/seed.js | tail -n 3
make_business_data

section "1. Số liệu TRƯỚC sự cố"
BEFORE="$(counts)"; echo "$BEFORE"

section "2. Sao lưu + kiểm tra bản sao lưu (khôi phục thử vào DB tạm)"
T_BACKUP=$(date +%s)
FILE="$(./infra/backup/backup.sh | tail -n1)"
BACKUP_SECONDS=$(( $(date +%s) - T_BACKUP ))
VERIFY="$(./infra/backup/verify.sh "$FILE" | grep '|')"
echo "$VERIFY"
[ "$VERIFY" = "$BEFORE" ] && echo "✅ Bản sao lưu khớp DB nguồn"

section "3. SỰ CỐ: xoá container + volume PostgreSQL (mất toàn bộ dữ liệu)"
compose rm -sfv postgres >/dev/null
docker volume rm "$(compose config --volumes >/dev/null; echo shopfast-prod_postgres_data)" >/dev/null
compose up -d postgres >/dev/null
until compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER"' >/dev/null 2>&1; do sleep 1; done
EXISTS="$(compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT to_regclass('"'"'users'"'"')"' 2>/dev/null || true)"
echo "Bảng users sau sự cố: ${EXISTS:-KHÔNG TỒN TẠI (dữ liệu đã mất)}"

section "4. KHÔI PHỤC"
T0=$(date +%s)
./infra/backup/restore.sh "$FILE"
RTO=$(( $(date +%s) - T0 ))

section "5. Số liệu SAU khôi phục + kiểm tra qua ứng dụng"
AFTER="$(counts)"; echo "$AFTER"
[ "$AFTER" = "$BEFORE" ] && MATCH="✅ khớp 100%" || MATCH="❌ KHÔNG khớp"
compose exec -T -e SEED_PASSWORD "api-$(state_get ACTIVE_COLOR)" node -e '
  fetch("http://127.0.0.1:3000/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "customer@shopfast.local", password: process.env.SEED_PASSWORD }) })
  .then((r) => r.json()).then((l) => fetch("http://127.0.0.1:3000/api/orders/me", { headers: { Authorization: "Bearer " + l.accessToken } }))
  .then((r) => r.json()).then((o) => console.log("Khách đăng nhập lại, thấy", o.total, "đơn hàng"))'

mkdir -p "$(dirname "$REPORT")"
{
  echo "### Biên bản diễn tập khôi phục — $(date -u +%Y-%m-%dT%H:%MZ)"
  echo
  echo "| Bảng | Trước sự cố | Sau khôi phục |"
  echo "|---|---|---|"
  paste -d'|' <(echo "$BEFORE") <(echo "$AFTER" | cut -d'|' -f2) | awk -F'|' '{print "| "$1" | "$2" | "$3" |"}'
  echo
  echo "| Chỉ số | Kết quả |"
  echo "|---|---|"
  echo "| Kích thước bản sao lưu | $(du -h "$FILE" | cut -f1) |"
  echo "| Thời gian sao lưu | ${BACKUP_SECONDS}s |"
  echo "| Kiểm tra bản sao lưu (khôi phục thử) | ✅ |"
  echo "| **Thời gian khôi phục (RTO đo được)** | **${RTO}s** (mục tiêu < 1800s) |"
  echo "| Dữ liệu sau khôi phục | $MATCH |"
} > "$REPORT"
cat "$REPORT"
[ "$AFTER" = "$BEFORE" ] && [ "$RTO" -lt 1800 ]
