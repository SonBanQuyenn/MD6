import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { calculateOrderTotals } from '../orders/pricing';
import { CartItemWithProduct, CartRepository } from './cart.repository';
import { MAX_QUANTITY_PER_ITEM } from './dto/cart.dto';

export interface CartLineView {
  productId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** false khi sản phẩm ngừng bán hoặc không đủ hàng → chặn đặt đơn */
  available: boolean;
  availableStock: number;
  warning: string | null;
}

export interface CartView {
  items: CartLineView[];
  itemCount: number;
  subtotal: number;
  canCheckout: boolean;
}

@Injectable()
export class CartService {
  constructor(private readonly cart: CartRepository) {}

  /** Giỏ hàng luôn hiển thị GIÁ HIỆN TẠI từ DB, kèm cảnh báo nếu hết hàng/ngừng bán. */
  async getCart(userId: string): Promise<CartView> {
    return toCartView(await this.cart.findItems(userId));
  }

  async addItem(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<CartView> {
    const existing = await this.cart.findItem(userId, productId);
    const newQuantity = (existing?.quantity ?? 0) + quantity;
    await this.setQuantityChecked(userId, productId, newQuantity);
    return this.getCart(userId);
  }

  async updateItem(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<CartView> {
    if (!(await this.cart.findItem(userId, productId))) {
      throw new NotFoundException('Sản phẩm không có trong giỏ hàng');
    }
    await this.setQuantityChecked(userId, productId, quantity);
    return this.getCart(userId);
  }

  async removeItem(userId: string, productId: string): Promise<CartView> {
    const removed = await this.cart.removeItem(userId, productId);
    if (removed === 0) {
      throw new NotFoundException('Sản phẩm không có trong giỏ hàng');
    }
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<void> {
    await this.cart.clear(userId);
  }

  private async setQuantityChecked(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const product = await this.cart.findProduct(productId);
    if (!product || !product.isActive) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      throw new BadRequestException(
        `Mỗi sản phẩm chỉ được mua tối đa ${MAX_QUANTITY_PER_ITEM}`,
      );
    }
    // Kiểm tra sớm để báo lỗi thân thiện. Chốt chặn thật nằm ở lúc đặt đơn (transaction).
    if (quantity > product.stock) {
      throw new ConflictException(
        product.stock === 0
          ? `"${product.name}" đã hết hàng`
          : `"${product.name}" chỉ còn ${product.stock} sản phẩm`,
      );
    }
    await this.cart.setQuantity(userId, productId, quantity);
  }
}

export function toCartView(items: CartItemWithProduct[]): CartView {
  const lines: CartLineView[] = items.map(({ product, quantity }) => {
    let warning: string | null = null;
    if (!product.isActive) warning = 'Sản phẩm đã ngừng bán';
    else if (product.stock === 0) warning = 'Sản phẩm đã hết hàng';
    else if (product.stock < quantity)
      warning = `Chỉ còn ${product.stock} sản phẩm`;

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      imageUrl: product.imageUrl,
      unitPrice: product.price,
      quantity,
      lineTotal: product.price * quantity,
      available: warning === null,
      availableStock: product.stock,
      warning,
    };
  });

  const { subtotal } = calculateOrderTotals(lines);
  return {
    items: lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal,
    canCheckout: lines.length > 0 && lines.every((line) => line.available),
  };
}
