import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { isPrismaError } from '../../common/utils/prisma-errors';
import { escapeHtml, formatVnd } from '../../mail/templates';
import { JobDataRepository, OrderForJobs } from '../job-data.repository';

export type InvoiceResult = 'created' | 'already-exists';

/** Xuất hoá đơn. Mỗi đơn đúng 1 hoá đơn: orderId UNIQUE + số hoá đơn suy ra từ mã đơn. */
@Injectable()
export class InvoiceService {
  constructor(private readonly data: JobDataRepository) {}

  async generate(orderId: string): Promise<InvoiceResult> {
    if (await this.data.findInvoiceByOrder(orderId)) return 'already-exists';

    const order = await this.data.findOrder(orderId);
    if (!order) throw new UnrecoverableError(`Không tìm thấy đơn ${orderId}`);

    try {
      await this.data.createInvoice({
        orderId,
        number: invoiceNumber(order.code),
        total: order.total,
        html: renderInvoice(order),
      });
      return 'created';
    } catch (error) {
      // 2 worker cùng tạo → worker chậm hơn vấp UNIQUE → coi như đã có hoá đơn.
      if (isPrismaError(error, 'P2002')) return 'already-exists';
      throw error;
    }
  }
}

/** SF-20261101-9F3A1C7B → INV-20261101-9F3A1C7B (xác định, không ngẫu nhiên). */
export const invoiceNumber = (orderCode: string) =>
  orderCode.replace(/^SF-/, 'INV-');

export function renderInvoice(order: OrderForJobs): string {
  const address = order.shippingAddress as Record<string, string>;
  const rows = order.items
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.sku)}</td><td>${escapeHtml(i.productName)}</td>` +
        `<td align="center">${i.quantity}</td><td align="right">${formatVnd(i.unitPrice)}</td>` +
        `<td align="right">${formatVnd(i.unitPrice * i.quantity)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Hoá đơn ${invoiceNumber(order.code)}</title></head>
<body style="font-family:Arial,sans-serif;max-width:800px;margin:auto">
<h1>HOÁ ĐƠN BÁN HÀNG</h1>
<p>Số: <b>${invoiceNumber(order.code)}</b> · Đơn hàng: ${order.code} ·
Ngày: ${order.createdAt.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
<p>Khách hàng: ${escapeHtml(address.fullName ?? order.user.fullName)} · ${escapeHtml(address.phone ?? '')}<br>
Địa chỉ: ${escapeHtml(address.addressLine ?? '')}, ${escapeHtml(address.city ?? '')}</p>
<table width="100%" border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>SKU</th><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr>
${rows}
<tr><td colspan="4" align="right">Tạm tính</td><td align="right">${formatVnd(order.subtotal)}</td></tr>
<tr><td colspan="4" align="right">Giảm giá</td><td align="right">-${formatVnd(order.discount)}</td></tr>
<tr><td colspan="4" align="right"><b>Tổng cộng</b></td><td align="right"><b>${formatVnd(order.total)}</b></td></tr>
</table>
<p>Phương thức thanh toán: ${order.paymentMethod === 'COD' ? 'Thanh toán khi nhận hàng' : 'Thanh toán online'}</p>
</body></html>`;
}
