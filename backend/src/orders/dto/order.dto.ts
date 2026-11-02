import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ShippingAddressDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Tên người nhận phải có ít nhất 2 ký tự' })
  @MaxLength(100, { message: 'Tên người nhận tối đa 100 ký tự' })
  fullName!: string;

  @Transform(trim)
  @Matches(/^(0|\+84)\d{9,10}$/, {
    message: 'Số điện thoại không hợp lệ (ví dụ 0912345678)',
  })
  phone!: string;

  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'Địa chỉ phải có ít nhất 5 ký tự' })
  @MaxLength(255, { message: 'Địa chỉ tối đa 255 ký tự' })
  addressLine!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Vui lòng nhập tỉnh/thành phố' })
  @MaxLength(100)
  city!: string;
}

/** Đặt đơn từ giỏ hàng. Danh sách sản phẩm & giá lấy từ DB, không lấy từ client. */
export class PlaceOrderDto {
  @IsEnum(PaymentMethod, {
    message: `paymentMethod phải là một trong: ${Object.values(PaymentMethod).join(', ')}`,
  })
  paymentMethod!: PaymentMethod;

  @IsObject({ message: 'Thiếu địa chỉ giao hàng' })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú tối đa 500 ký tự' })
  note?: string;
}

export class PlacePromotionalOrderDto extends PlaceOrderDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'Mã khuyến mãi không hợp lệ' })
  promotionCode!: string;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus, {
    message: `status phải là một trong: ${Object.values(OrderStatus).join(', ')}`,
  })
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú tối đa 500 ký tự' })
  note?: string;
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus, { message: 'status không hợp lệ' })
  status?: OrderStatus;
}
