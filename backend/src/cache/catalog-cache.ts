import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { CacheService } from './cache.service';

/**
 * Thiết kế khoá cache của danh mục sản phẩm:
 *
 *  product:<id>                     → chi tiết 1 sản phẩm (giá, tồn kho, …)        TTL 10'
 *  products:list:v<N>:<hash bộ lọc> → CHỈ danh sách ID + tổng số của 1 trang lọc  TTL 5'
 *  catalog:categories:v<N>, catalog:brands:v<N>                                    TTL 10'
 *  catalog:version                  → số N, tăng lên = mọi khoá danh sách cũ vô hiệu
 *
 * Vì danh sách chỉ lưu ID, đổi giá/tồn kho 1 sản phẩm chỉ cần xoá `product:<id>` là
 * mọi trang danh sách hiển thị giá mới ngay. Chỉ khi TẬP KẾT QUẢ lọc có thể đổi
 * (đổi giá → lọc theo giá, đổi danh mục, ngừng bán, thêm SP) mới tăng version.
 */
export const CACHE_TTL = {
  PRODUCT: 600,
  PRODUCT_LIST: 300,
  TAXONOMY: 600,
  NULL: 60,
} as const;

export const catalogKeys = {
  version: 'catalog:version',
  product: (id: string) => `product:${id}`,
  productList: (version: number, query: Record<string, unknown>) =>
    `products:list:v${version}:${hashQuery(query)}`,
  categories: (version: number) => `catalog:categories:v${version}`,
  brands: (version: number) => `catalog:brands:v${version}`,
};

/** Chuẩn hoá bộ lọc (sắp xếp khoá, bỏ giá trị rỗng) → cùng bộ lọc luôn ra cùng khoá. */
export function hashQuery(query: Record<string, unknown>): string {
  const normalized = Object.keys(query)
    .filter(
      (k) => query[k] !== undefined && query[k] !== null && query[k] !== '',
    )
    .sort()
    .map((k) => `${k}=${String(query[k])}`)
    .join('&');
  return createHash('sha1').update(normalized).digest('hex');
}

/** Độ trễ của lần xoá thứ 2 (xem invalidateProducts). */
export const SECOND_DELETE_DELAY_MS = 1_000;

/**
 * Làm mới cache khi dữ liệu đổi. Gọi SAU khi transaction DB đã commit.
 * Dùng ở: sản phẩm (admin), tồn kho (kho), đặt/huỷ đơn.
 */
@Injectable()
export class CatalogCacheInvalidator {
  constructor(private readonly cache: CacheService) {}

  /**
   * Xoá cache chi tiết của các sản phẩm — dùng khi giá / tồn kho đổi.
   *
   * "Xoá 2 lần" (delayed double delete): một request đọc DB NGAY TRƯỚC khi ta commit có thể
   * ghi giá cũ vào cache SAU khi ta đã xoá. Lần xoá thứ 2 sau 1 giây dọn trường hợp đó,
   * nên giá cũ (nếu có) chỉ tồn tại tối đa ~1 giây thay vì cả TTL 10 phút.
   */
  async invalidateProducts(productIds: string[]): Promise<void> {
    const keys = [...new Set(productIds)].map(catalogKeys.product);
    await this.cache.del(...keys);
    setTimeout(
      () => void this.cache.del(...keys),
      SECOND_DELETE_DELAY_MS,
    ).unref();
  }

  /** Tập kết quả lọc có thể đã đổi → tăng version, mọi khoá danh sách cũ không còn được đọc. */
  async invalidateLists(): Promise<void> {
    await this.cache.incr(catalogKeys.version);
  }
}
