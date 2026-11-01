import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AuthUser } from '../common/types/auth-user';
import { AdjustInventoryDto, LowStockQueryDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

/** Quản lý tồn kho — chỉ nhân viên kho và quản trị viên. */
@Controller('inventory')
@Roles(Role.WAREHOUSE_STAFF, Role.ADMIN)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** POST /api/inventory/adjustments — nhập/xuất kho thủ công. */
  @Post('adjustments')
  adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustInventoryDto) {
    return this.inventoryService.adjust(user.id, dto);
  }

  /** GET /api/inventory/low-stock?threshold=10 — sản phẩm sắp hết hàng. */
  @Get('low-stock')
  lowStock(@Query() query: LowStockQueryDto) {
    return this.inventoryService.lowStock(query);
  }

  /** GET /api/inventory/products/:productId/movements — lịch sử biến động. */
  @Get('products/:productId/movements')
  movements(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.inventoryService.movements(productId, query);
  }
}
