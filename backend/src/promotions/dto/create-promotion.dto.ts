import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePromotionDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{4,30}$/, {
    message: 'Mã khuyến mãi gồm 4–30 ký tự chữ in hoa hoặc số',
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsInt({ message: 'discountPercent phải là số nguyên' })
  @Min(1, { message: 'Giảm tối thiểu 1%' })
  @Max(90, { message: 'Giảm tối đa 90%' })
  discountPercent!: number;

  @IsOptional()
  @IsInt({ message: 'maxDiscount phải là số nguyên (VND)' })
  @Min(1000, { message: 'maxDiscount tối thiểu 1.000đ' })
  maxDiscount?: number;

  @IsInt({ message: 'maxUses phải là số nguyên' })
  @Min(1, { message: 'maxUses tối thiểu là 1' })
  @Max(1_000_000)
  maxUses!: number;

  @IsOptional()
  @IsInt({ message: 'perUserLimit phải là số nguyên' })
  @Min(1)
  @Max(100)
  perUserLimit?: number;

  @Type(() => Date)
  @IsDate({ message: 'startsAt phải là ngày giờ hợp lệ (ISO 8601)' })
  startsAt!: Date;

  @Type(() => Date)
  @IsDate({ message: 'endsAt phải là ngày giờ hợp lệ (ISO 8601)' })
  endsAt!: Date;
}
