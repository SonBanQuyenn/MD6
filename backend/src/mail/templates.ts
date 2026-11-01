/** Mẫu email HTML đơn giản. Mọi dữ liệu người dùng nhập đều được escape để tránh chèn HTML. */

export const formatVnd = (amount: number | bigint) =>
  `${Number(amount).toLocaleString('vi-VN')}đ`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface OrderEmailData {
  code: string;
  customerName: string;
  total: number;
  items: { productName: string; quantity: number; unitPrice: number }[];
}

const layout = (title: string, body: string) => `<!doctype html>
<html lang="vi"><body style="font-family:Arial,sans-serif;color:#222;max-width:600px;margin:auto">
<h2 style="color:#e8590c">ShopFast</h2><h3>${escapeHtml(title)}</h3>${body}
<p style="color:#888;font-size:12px">Email tự động từ ShopFast, vui lòng không trả lời.</p>
</body></html>`;

const itemRows = (items: OrderEmailData['items']) =>
  items
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.productName)}</td><td align="center">${i.quantity}</td>` +
        `<td align="right">${formatVnd(i.unitPrice * i.quantity)}</td></tr>`,
    )
    .join('');

export function orderConfirmationEmail(order: OrderEmailData) {
  return {
    subject: `[ShopFast] Xác nhận đơn hàng ${order.code}`,
    html: layout(
      `Cảm ơn ${order.customerName}, chúng tôi đã nhận đơn ${order.code}`,
      `<table width="100%" cellpadding="6" style="border-collapse:collapse">
<tr><th align="left">Sản phẩm</th><th>SL</th><th align="right">Thành tiền</th></tr>
${itemRows(order.items)}
<tr><td colspan="2"><b>Tổng cộng</b></td><td align="right"><b>${formatVnd(order.total)}</b></td></tr>
</table>`,
    ),
  };
}

export function paymentReminderEmail(order: OrderEmailData) {
  return {
    subject: `[ShopFast] Đơn ${order.code} đang chờ thanh toán`,
    html: layout(
      `Đơn hàng ${order.code} chưa được thanh toán`,
      `<p>Xin chào ${escapeHtml(order.customerName)}, đơn hàng trị giá
<b>${formatVnd(order.total)}</b> của bạn vẫn đang chờ thanh toán.
Vui lòng hoàn tất thanh toán để chúng tôi xử lý đơn sớm nhất.</p>`,
    ),
  };
}

export function dailyRevenueEmail(report: {
  date: string;
  orderCount: number;
  cancelledCount: number;
  revenue: bigint;
}) {
  return {
    subject: `[ShopFast] Báo cáo doanh thu ngày ${report.date}`,
    html: layout(
      `Báo cáo doanh thu ngày ${report.date}`,
      `<ul><li>Số đơn hợp lệ: <b>${report.orderCount}</b></li>
<li>Số đơn đã huỷ: ${report.cancelledCount}</li>
<li>Doanh thu: <b>${formatVnd(report.revenue)}</b></li></ul>`,
    ),
  };
}
