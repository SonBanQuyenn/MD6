import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MESSAGE = 'slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang';

/** Dùng chung cho Danh mục và Thương hiệu (cùng cấu trúc: tên + slug). */
export class CreateTaxonomyDto {
  @Transform(trim)
  @IsString({ message: 'Tên phải là chuỗi ký tự' })
  @MinLength(2, { message: 'Tên phải có ít nhất 2 ký tự' })
  @MaxLength(100, { message: 'Tên tối đa 100 ký tự' })
  name!: string;

  /** Không gửi → tự sinh từ tên. */
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(120, { message: 'slug tối đa 120 ký tự' })
  slug?: string;
}

export class UpdateTaxonomyDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Tên phải là chuỗi ký tự' })
  @MinLength(2, { message: 'Tên phải có ít nhất 2 ký tự' })
  @MaxLength(100, { message: 'Tên tối đa 100 ký tự' })
  name?: string;

  @IsOptional()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(120, { message: 'slug tối đa 120 ký tự' })
  slug?: string;
}
