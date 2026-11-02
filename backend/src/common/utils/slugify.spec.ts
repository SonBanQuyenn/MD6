import { slugify } from './slugify';

describe('slugify', () => {
  it.each([
    ['Điện thoại', 'dien-thoai'],
    ['Bàn phím & Chuột', 'ban-phim-chuot'],
    ['Đồng hồ thông minh', 'dong-ho-thong-minh'],
    ['  iPhone 15 Pro Max!! ', 'iphone-15-pro-max'],
    ['Máy ảnh -- Fujifilm', 'may-anh-fujifilm'],
  ])('%p → %p', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
