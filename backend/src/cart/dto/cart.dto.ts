import { IsInt, IsUUID, Max, Min } from 'class-validator';

export const MAX_QUANTITY_PER_ITEM = 99;

export class AddCartItemDto {
  @IsUUID('4', { message: 'productId không hợp lệ' })
  productId!: string;

  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, { message: 'Số lượng tối thiểu là 1' })
  @Max(MAX_QUANTITY_PER_ITEM, {
    message: `Số lượng tối đa là ${MAX_QUANTITY_PER_ITEM}`,
  })
  quantity: number = 1;
}

export class UpdateCartItemDto {
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, {
    message: 'Số lượng tối thiểu là 1 (muốn bỏ sản phẩm hãy dùng DELETE)',
  })
  @Max(MAX_QUANTITY_PER_ITEM, {
    message: `Số lượng tối đa là ${MAX_QUANTITY_PER_ITEM}`,
  })
  quantity!: number;
}
