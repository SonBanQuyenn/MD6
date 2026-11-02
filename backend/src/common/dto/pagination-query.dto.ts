import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Tham số phân trang dùng chung: ?page=1&limit=20 (limit tối đa 50). */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(50, { message: 'limit tối đa là 50' })
  limit: number = 20;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
