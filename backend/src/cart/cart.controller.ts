import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';

/** Giỏ hàng của khách đang đăng nhập — mỗi khách chỉ thấy giỏ của chính mình. */
@Controller('cart')
@Roles(Role.CUSTOMER)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cartService.getCart(user.id);
  }

  /** POST /api/cart/items — thêm sản phẩm (cộng dồn nếu đã có trong giỏ). */
  @Post('items')
  add(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.id, dto.productId, dto.quantity);
  }

  /** PATCH /api/cart/items/:productId — đặt lại số lượng. */
  @Patch('items/:productId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.id, productId, dto.quantity);
  }

  @Delete('items/:productId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.cartService.removeItem(user.id, productId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(@CurrentUser() user: AuthUser) {
    return this.cartService.clear(user.id);
  }
}
