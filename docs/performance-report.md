# Báo cáo hiệu năng — ShopFast

> Mọi số liệu dưới đây là **đo thật**, ghi kèm điều kiện đo. Không suy diễn sang môi trường khác.
> Số đo trên AWS EC2 (qua Internet, có Nginx + HTTPS) sẽ được bổ sung ở Phase 13.

## Lần đo 1 — API tra cứu sản phẩm có cache (F04, NFR-PERF-01, NFR-PERF-04)

**Ngày đo:** 2026-11-01 · **Nhánh:** `feature/redis-caching`

**Môi trường:** máy phát triển Windows 11 (máy cá nhân), backend NestJS chạy `node dist/main.js`
(1 tiến trình), PostgreSQL 16 + Redis 7 trong Docker Desktop trên cùng máy; k6 chạy trong Docker,
gọi qua `host.docker.internal:3000`. **Không** có độ trễ mạng Internet, **không** qua Nginx/HTTPS.

**Dữ liệu:** seed 500 sản phẩm, 10 danh mục. Redis được xoá sạch (`FLUSHDB`) trước khi đo → bao
gồm cả giai đoạn "cache nguội".

**Kịch bản:** [`perf/products-read.js`](../perf/products-read.js) — 20 người dùng ảo trong 30 giây;
70% xem chi tiết 1 trong 100 sản phẩm, 30% xem danh mục có bộ lọc (10 danh mục × 3 cách sắp xếp × 2 trang).

```
docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 grafana/k6:0.54.0 run - < perf/products-read.js
```

### Kết quả

| Chỉ tiêu | Ngưỡng SRS | Đo được | Đạt? |
|---|---|---|---|
| p95 chi tiết sản phẩm | < 50 ms | **8,53 ms** | ✅ |
| p95 danh mục có bộ lọc | < 50 ms | **16,47 ms** | ✅ |
| Tỉ lệ request trúng cache (header `X-Cache: HIT`) | ≥ 80 % | **99,39 %** (10.363 / 10.426) | ✅ |
| Tỉ lệ lỗi HTTP | — | 0 % (0 / 10.429) | ✅ |
| Thông lượng | — | ~346 request/giây | — |

Chi tiết k6: chi tiết sản phẩm avg 3,2 ms, max 21,98 ms; danh sách avg 15,43 ms, median 4,9 ms,
**max 2,08 s**.

`GET /api/admin/metrics/cache` sau lần đo: `hits 73.763, misses 76, lockWaits 13, errors 0`
(con số này đếm theo từng khoá — 1 trang danh sách = 1 khoá danh sách + 20 khoá chi tiết, nên cao
hơn tỉ lệ theo request).

### Đo thủ công "lần thứ hai < 20 ms" (F04.1)

| Request | Lần 1 (MISS) | Lần 2+ (HIT) |
|---|---|---|
| `GET /api/products/:id` | 14,5 ms | 2,9 – 3,2 ms |
| `GET /api/products?categoryId=…&minPrice=…&sort=…&page=2` | 19,8 ms | 5,1 – 6,7 ms |

### Đánh giá trung thực

- Đạt ngưỡng trong điều kiện **cục bộ**. Trên EC2, thời gian phản hồi phía server tương tự nhưng
  người dùng sẽ cộng thêm độ trễ mạng — sẽ đo lại cả 2: tại server và qua Internet.
- Tỉ lệ hit 99 % cao vì tập "sản phẩm nóng" chỉ 100 SP. Người dùng thật xem rải rác hơn → tỉ lệ thấp
  hơn; cần đo lại với phân bố thực tế hơn.
- **Max 2,08 s** của danh sách xảy ra ở giây đầu khi cache trống: nhiều request cùng chờ khoá
  (`lockWaits = 13`), cộng với kết nối DB đầu tiên của Prisma. Không ảnh hưởng p95 nhưng là điểm cần
  theo dõi (có thể "làm ấm" cache sau mỗi lần deploy).

### Khi Redis không sẵn sàng (F04.4)

Tắt container Redis rồi gọi API: chi tiết 6–11 ms, danh sách 20 ms, danh mục 6 ms — **tất cả 200**,
header `X-Cache: BYPASS`. Bật lại Redis → request kế tiếp trở lại `HIT`, không cần khởi động lại API.
