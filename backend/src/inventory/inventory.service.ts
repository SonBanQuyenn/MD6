import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMovement, InventoryReason } from '@prisma/client';
import { CatalogCacheInvalidator } from '../cache/catalog-cache';
import {
  Paginated,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { AdjustInventoryDto, LowStockQueryDto } from './dto/inventory.dto';
import { InventoryRepository } from './inventory.repository';

export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  stock: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly invalidator: CatalogCacheInvalidator,
  ) {}

  async adjust(
    actorId: string,
    dto: AdjustInventoryDto,
  ): Promise<{ product: StockLevel; movement: InventoryMovement }> {
    const result = await this.inventory.adjust({
      ...dto,
      reason: InventoryReason.MANUAL_ADJUST,
      actorId,
    });
    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') {
        throw new NotFoundException('Không tìm thấy sản phẩm');
      }
      throw new ConflictException(
        `Không đủ tồn kho để xuất: hiện chỉ còn ${result.available} sản phẩm`,
      );
    }
    const { product, movement } = result;
    // Tồn kho đổi → khách phải thấy số mới ngay (F04.2)
    await this.invalidator.invalidateProducts([product.id]);
    return {
      product: {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        stock: product.stock,
      },
      movement,
    };
  }

  async movements(
    productId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<InventoryMovement>> {
    if (!(await this.inventory.productExists(productId))) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    const { page, limit } = query;
    const { items, total } = await this.inventory.findMovements(productId, {
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async lowStock(query: LowStockQueryDto): Promise<Paginated<StockLevel>> {
    const { page, limit, threshold } = query;
    const { items, total } = await this.inventory.findLowStock(threshold, {
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: items.map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        stock: p.stock,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
