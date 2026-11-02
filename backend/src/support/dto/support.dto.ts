import { TicketCategory, TicketStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTicketDto {
  @Transform(trim)
  @IsString({ message: 'Chủ đề phải là chuỗi ký tự' })
  @MinLength(5, { message: 'Chủ đề phải có ít nhất 5 ký tự' })
  @MaxLength(150, { message: 'Chủ đề tối đa 150 ký tự' })
  subject!: string;

  @Transform(trim)
  @IsString({ message: 'Nội dung phải là chuỗi ký tự' })
  @MinLength(10, { message: 'Nội dung phải có ít nhất 10 ký tự' })
  @MaxLength(4000, { message: 'Nội dung tối đa 4000 ký tự' })
  message!: string;

  @IsOptional()
  @IsUUID('4', { message: 'Mã đơn hàng không hợp lệ' })
  orderId?: string;
}

export class AddMessageDto {
  @Transform(trim)
  @IsString({ message: 'Nội dung phải là chuỗi ký tự' })
  @MinLength(1, { message: 'Vui lòng nhập nội dung' })
  @MaxLength(4000, { message: 'Nội dung tối đa 4000 ký tự' })
  content!: string;
}

export class AskAssistantDto {
  @Transform(trim)
  @IsString({ message: 'Câu hỏi phải là chuỗi ký tự' })
  @MinLength(2, { message: 'Vui lòng nhập câu hỏi' })
  @MaxLength(1000, { message: 'Câu hỏi tối đa 1000 ký tự' })
  question!: string;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus, { message: 'Trạng thái ticket không hợp lệ' })
  status?: TicketStatus;

  /** Nhân viên sửa phân loại → classifiedBy = HUMAN, AI không ghi đè nữa. */
  @IsOptional()
  @IsEnum(TicketCategory, { message: 'Nhóm ticket không hợp lệ' })
  category?: TicketCategory;
}

export class ReviewActionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500, { message: 'Ghi chú tối đa 500 ký tự' })
  note?: string;
}

export class ListTicketsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TicketStatus, { message: 'Trạng thái ticket không hợp lệ' })
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketCategory, { message: 'Nhóm ticket không hợp lệ' })
  category?: TicketCategory;
}
