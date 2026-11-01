import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Promotion } from '@prisma/client';
import { isPrismaError } from '../common/utils/prisma-errors';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { PromotionsRepository } from './promotions.repository';

@Injectable()
export class PromotionsService {
  constructor(private readonly promotions: PromotionsRepository) {}

  list(): Promise<Promotion[]> {
    return this.promotions.findAll();
  }

  async create(dto: CreatePromotionDto): Promise<Promotion> {
    if (dto.endsAt <= dto.startsAt) {
      throw new BadRequestException('endsAt phải sau startsAt');
    }
    try {
      return await this.promotions.create(dto);
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Mã khuyến mãi đã tồn tại');
      }
      throw error;
    }
  }

  /**
   * Kiểm tra SỚM mã khuyến mãi trước khi đặt đơn để báo lỗi rõ ràng.
   * Việc trừ lượt dùng thật sự diễn ra nguyên tử trong transaction đặt đơn.
   */
  async getUsable(code: string, now = new Date()): Promise<Promotion> {
    const promotion = await this.promotions.findByCode(
      code.trim().toUpperCase(),
    );
    if (!promotion || !promotion.isActive) {
      throw new NotFoundException('Mã khuyến mãi không tồn tại');
    }
    if (now < promotion.startsAt) {
      throw new BadRequestException('Chương trình khuyến mãi chưa bắt đầu');
    }
    if (now > promotion.endsAt) {
      throw new BadRequestException('Mã khuyến mãi đã hết hạn');
    }
    if (promotion.usedCount >= promotion.maxUses) {
      throw new ConflictException('Mã khuyến mãi đã hết lượt sử dụng');
    }
    return promotion;
  }
}
