import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Đăng ký luôn tạo tài khoản CUSTOMER. Không có field `role` ở đây —
 * và ValidationPipe `forbidNonWhitelisted` sẽ báo lỗi nếu client cố gửi `role`.
 */
export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(254, { message: 'Email quá dài' })
  email!: string;

  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự' })
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  // bcrypt chỉ dùng 72 byte đầu → giới hạn để không có phần mật khẩu bị bỏ qua.
  @MaxLength(72, { message: 'Mật khẩu tối đa 72 ký tự' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số',
  })
  password!: string;

  @Transform(trim)
  @IsString({ message: 'Họ tên phải là chuỗi ký tự' })
  @MinLength(2, { message: 'Họ tên phải có ít nhất 2 ký tự' })
  @MaxLength(100, { message: 'Họ tên tối đa 100 ký tự' })
  fullName!: string;
}
