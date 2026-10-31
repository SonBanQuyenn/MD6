import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_PRICE } from './list-products-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProductDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9-]{3,50}$/, {
    message: 'SKU gồm 3–50 ký tự: chữ in hoa, số, dấu gạch ngang',
  })
  sku!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Tên sản phẩm phải có ít nhất 2 ký tự' })
  @MaxLength(200, { message: 'Tên sản phẩm tối đa 200 ký tự' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Mô tả tối đa 5000 ký tự' })
  description?: string;

  @IsInt({ message: 'Giá phải là số nguyên (VND)' })
  @Min(0, { message: 'Giá không được âm' })
  @Max(MAX_PRICE, { message: 'Giá quá lớn' })
  price!: number;

  /** Tồn kho ban đầu. Sau khi tạo, tồn kho chỉ đổi qua nghiệp vụ kho/đơn hàng. */
  @IsOptional()
  @IsInt({ message: 'Tồn kho phải là số nguyên' })
  @Min(0, { message: 'Tồn kho không được âm' })
  @Max(1_000_000, { message: 'Tồn kho quá lớn' })
  stock?: number;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'] }, { message: 'imageUrl không hợp lệ' })
  imageUrl?: string;

  @IsUUID('4', { message: 'categoryId không hợp lệ' })
  categoryId!: string;

  @IsUUID('4', { message: 'brandId không hợp lệ' })
  brandId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Cập nhật sản phẩm. KHÔNG có `stock` và `sku`:
 * - tồn kho đổi qua API kho (có ghi lịch sử biến động),
 * - SKU là mã định danh cố định.
 */
export class UpdateProductDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Tên sản phẩm phải có ít nhất 2 ký tự' })
  @MaxLength(200, { message: 'Tên sản phẩm tối đa 200 ký tự' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Mô tả tối đa 5000 ký tự' })
  description?: string;

  @IsOptional()
  @IsInt({ message: 'Giá phải là số nguyên (VND)' })
  @Min(0, { message: 'Giá không được âm' })
  @Max(MAX_PRICE, { message: 'Giá quá lớn' })
  price?: number;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'] }, { message: 'imageUrl không hợp lệ' })
  imageUrl?: string;

  @IsOptional()
  @IsUUID('4', { message: 'categoryId không hợp lệ' })
  categoryId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'brandId không hợp lệ' })
  brandId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
