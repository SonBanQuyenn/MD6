/**
 * k6 — đo thời gian phản hồi API tra cứu sản phẩm có cache (NFR-PERF-01: p95 < 50 ms)
 * và tỉ lệ trúng cache (NFR-PERF-04: ≥ 80%).
 *
 * Chạy (cần backend đang chạy ở cổng 3000):
 *   docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 grafana/k6:0.54.0 run - < perf/products-read.js
 *
 * Kịch bản giống người thật: 70% xem chi tiết sản phẩm, 30% xem danh mục có bộ lọc,
 * chọn ngẫu nhiên trong 100 sản phẩm / 10 danh mục.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const cacheHit = new Rate('cache_hit');

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || '30s',
  thresholds: {
    'http_req_duration{kind:detail}': ['p(95)<50'],
    'http_req_duration{kind:list}': ['p(95)<50'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const ids = [];
  for (let page = 1; page <= 2; page++) {
    const res = http.get(`${BASE}/api/products?limit=50&page=${page}`);
    ids.push(...res.json('items').map((p) => p.id));
  }
  const categories = http.get(`${BASE}/api/categories`).json().map((c) => c.id);
  return { ids, categories };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export default function (data) {
  let res;
  if (Math.random() < 0.7) {
    res = http.get(`${BASE}/api/products/${pick(data.ids)}`, {
      tags: { kind: 'detail' },
    });
  } else {
    const sort = pick(['newest', 'price_asc', 'price_desc']);
    const page = pick([1, 2]);
    res = http.get(
      `${BASE}/api/products?categoryId=${pick(data.categories)}&sort=${sort}&page=${page}`,
      { tags: { kind: 'list' } },
    );
  }
  check(res, { 'status 200': (r) => r.status === 200 });
  cacheHit.add(res.headers['X-Cache'] === 'HIT');
  sleep(0.05);
}
