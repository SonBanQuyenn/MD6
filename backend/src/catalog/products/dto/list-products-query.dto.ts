import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export enum ProductSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NAME_ASC = 'name_asc',
}

export const MAX_PRICE = 2_000_000_000;

/**
 * GET /api/products?categoryId=&brandId=&minPrice=&maxPrice=&q=&sort=&page=&limit=
 * (yêu cầu F06.1: lọc theo danh mục, khoảng giá, thương hiệu và phân trang)
 */
export class ListProductsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'categoryId không hợp lệ' })
  categoryId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'brandId không hợp lệ' })
  brandId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minPrice phải là số nguyên' })
  @Min(0, { message: 'minPrice không được âm' })
  @Max(MAX_PRICE, { message: 'minPrice quá lớn' })
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxPrice phải là số nguyên' })
  @Min(0, { message: 'maxPrice không được âm' })
  @Max(MAX_PRICE, { message: 'maxPrice quá lớn' })
  maxPrice?: number;

  /** Tìm theo tên sản phẩm (không phân biệt hoa thường). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100, { message: 'Từ khoá tìm kiếm tối đa 100 ký tự' })
  q?: string;

  @IsOptional()
  @IsEnum(ProductSort, {
    message: `sort phải là một trong: ${Object.values(ProductSort).join(', ')}`,
  })
  sort: ProductSort = ProductSort.NEWEST;
}
