import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Nhập thêm hàng (delta > 0) hoặc xuất bớt / hàng hỏng (delta < 0). */
export class AdjustInventoryDto {
  @IsUUID('4', { message: 'productId không hợp lệ' })
  productId!: string;

  @IsInt({ message: 'delta phải là số nguyên' })
  @NotEquals(0, { message: 'delta phải khác 0' })
  @Min(-100_000, { message: 'delta quá nhỏ' })
  @Max(100_000, { message: 'delta quá lớn' })
  delta!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú tối đa 500 ký tự' })
  note?: string;
}

export class LowStockQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'threshold phải là số nguyên' })
  @Min(0, { message: 'threshold không được âm' })
  @Max(10_000, { message: 'threshold quá lớn' })
  threshold: number = 10;
}
