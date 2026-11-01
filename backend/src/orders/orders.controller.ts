import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import {
  ListOrdersQueryDto,
  PlaceOrderDto,
  PlacePromotionalOrderDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';
import { PlaceOrderResult, OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** POST /api/orders — đặt đơn từ giỏ hàng. Bắt buộc header Idempotency-Key. */
  @Post()
  @Roles(Role.CUSTOMER)
  async place(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PlaceOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      res,
      await this.ordersService.placeOrder(user.id, idempotencyKey, dto),
    );
  }

  /**
   * POST /api/orders/promotional — đặt đơn có mã khuyến mãi.
   * Tách endpoint riêng để Phase 6 áp hạn mức tần suất chặt hơn (yêu cầu F03).
   */
  @Post('promotional')
  @Roles(Role.CUSTOMER)
  async placePromotional(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PlacePromotionalOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { promotionCode, ...orderDto } = dto;
    return respond(
      res,
      await this.ordersService.placeOrder(
        user.id,
        idempotencyKey,
        orderDto,
        promotionCode,
      ),
    );
  }

  /** GET /api/orders/me — lịch sử đơn của khách. (Khai báo trước ':id') */
  @Get('me')
  @Roles(Role.CUSTOMER)
  listMine(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQueryDto) {
    return this.ordersService.listMine(user.id, query);
  }

  /** GET /api/orders — mọi đơn hàng (nhân viên). */
  @Get()
  @Roles(Role.SUPPORT_AGENT, Role.WAREHOUSE_STAFF, Role.ADMIN)
  listAll(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.listAll(query);
  }

  /** GET /api/orders/:id — khách: chỉ đơn của mình; nhân viên: mọi đơn. */
  @Get(':id')
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getForUser(user, id);
  }

  /** PATCH /api/orders/:id/status — kho cập nhật trạng thái. */
  @Patch(':id/status')
  @Roles(Role.WAREHOUSE_STAFF, Role.ADMIN)
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.changeStatusByStaff(
      user,
      id,
      dto.status,
      dto.note,
    );
  }

  @Post(':id/cancel')
  @Roles(Role.CUSTOMER)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.cancelByCustomer(user, id);
  }

  /** POST /api/orders/:id/pay — thanh toán GIẢ LẬP (MOCK_ONLINE). */
  @Post(':id/pay')
  @Roles(Role.CUSTOMER)
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.payByCustomer(user, id);
  }
}

function respond(res: Response, result: PlaceOrderResult) {
  if (result.replayed) {
    // Báo cho client biết đây là kết quả của lần gửi trước, không phải đơn mới.
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(200);
  }
  return result.order;
}
