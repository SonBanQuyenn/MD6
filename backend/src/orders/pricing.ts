/** Giá trị tối đa một đơn hàng (giới hạn cột INTEGER của PostgreSQL ~2,1 tỷ). */
export const MAX_ORDER_TOTAL = 2_000_000_000;

export interface PriceLine {
  unitPrice: number;
  quantity: number;
}

export interface DiscountRule {
  discountPercent: number;
  maxDiscount: number | null;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  total: number;
}

/**
 * Tính tiền đơn hàng — luôn tính ở SERVER từ giá trong DB, không tin số tiền client gửi lên.
 * Giảm giá làm tròn xuống tới đồng (VND không có phần lẻ).
 */
export function calculateOrderTotals(
  lines: PriceLine[],
  rule?: DiscountRule | null,
): OrderTotals {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  let discount = 0;
  if (rule) {
    discount = Math.floor((subtotal * rule.discountPercent) / 100);
    if (rule.maxDiscount !== null) {
      discount = Math.min(discount, rule.maxDiscount);
    }
  }
  return { subtotal, discount, total: subtotal - discount };
}
