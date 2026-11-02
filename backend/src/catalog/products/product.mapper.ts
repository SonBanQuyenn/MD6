import { ProductWithRelations } from './products.repository';

/** Dữ liệu sản phẩm trả cho client. */
export interface ProductView {
  id: string;
  sku: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  inStock: boolean;
  imageUrl: string | null;
  isActive: boolean;
  category: { id: string; name: string; slug: string };
  brand: { id: string; name: string; slug: string };
  createdAt: Date;
  updatedAt: Date;
}

export function toProductView(p: ProductWithRelations): ProductView {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: p.price,
    stock: p.stock,
    inStock: p.stock > 0,
    imageUrl: p.imageUrl,
    isActive: p.isActive,
    category: p.category,
    brand: p.brand,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
