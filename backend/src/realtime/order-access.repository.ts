import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Truy vấn tối thiểu để kiểm tra quyền theo dõi đơn (chỉ đọc chủ đơn + trạng thái). */
@Injectable()
export class OrderAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwner(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true },
    });
  }
}
