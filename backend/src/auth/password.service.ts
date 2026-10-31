import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

/**
 * Băm và so khớp mật khẩu bằng bcrypt.
 * bcrypt tự sinh "salt" ngẫu nhiên cho từng mật khẩu và cố tình chạy chậm
 * → kẻ lấy được database cũng rất khó dò ngược ra mật khẩu gốc.
 */
@Injectable()
export class PasswordService {
  private readonly rounds: number;

  constructor(config: ConfigService) {
    this.rounds = config.get<number>('BCRYPT_ROUNDS', 12);
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
