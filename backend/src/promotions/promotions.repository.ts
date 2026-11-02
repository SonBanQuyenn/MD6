import { Injectable } from '@nestjs/common';
import { Prisma, Promotion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PromotionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCode(code: string): Promise<Promotion | null> {
    return this.prisma.promotion.findUnique({ where: { code } });
  }

  findAll(): Promise<Promotion[]> {
    return this.prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(data: Prisma.PromotionCreateInput): Promise<Promotion> {
    return this.prisma.promotion.create({ data });
  }
}
