/**
 * Chuyển tên tiếng Việt thành slug dùng trong URL.
 *   "Điện thoại & Máy tính bảng" → "dien-thoai-may-tinh-bang"
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD') // tách dấu khỏi chữ: "ệ" → "e" + dấu
    .replace(/[̀-ͯ]/g, '') // bỏ các dấu
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // ký tự khác chữ/số → "-"
    .replace(/^-+|-+$/g, ''); // bỏ "-" ở đầu/cuối
}
