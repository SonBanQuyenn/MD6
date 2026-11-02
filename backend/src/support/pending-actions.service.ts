import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MessageAuthor,
  OrderStatus,
  PendingActionStatus,
} from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import { OrdersService } from '../orders/orders.service';
import { CANCEL_ORDER } from './support-tools';
import { TicketsRepository } from './tickets.repository';

/**
 * Bước XÁC NHẬN CỦA CON NGƯỜI (F01.4): AI chỉ đề xuất; nhân viên duyệt thì mới thực thi.
 * Khi duyệt, nghiệp vụ được kiểm tra LẠI qua OrdersService (đơn có thể đã đổi trạng thái
 * kể từ lúc AI đề xuất) — không tin vào kết quả kiểm tra cũ.
 */
@Injectable()
export class PendingActionsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly orders: OrdersService,
  ) {}

  async approve(agent: AuthUser, actionId: string, note?: string) {
    const action = await this.tickets.findPendingAction(actionId);
    if (!action) throw new NotFoundException('Không tìm thấy đề xuất');

    // Giành quyền xử lý: chỉ 1 nhân viên thắng nếu nhiều người bấm cùng lúc
    const claimed = await this.tickets.claimPendingAction(
      actionId,
      agent.id,
      PendingActionStatus.EXECUTED,
    );
    if (!claimed) {
      throw new ConflictException('Đề xuất này đã được xử lý trước đó');
    }

    try {
      const result = await this.execute(action, agent, note);
      await this.tickets.finishPendingAction(
        actionId,
        PendingActionStatus.EXECUTED,
        result,
      );
      await this.log(
        action.ticketId,
        agent,
        `Đã duyệt và thực hiện: ${describe(action.payload)}`,
      );
      return { id: actionId, status: PendingActionStatus.EXECUTED, result };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Thực hiện thất bại';
      await this.tickets.finishPendingAction(
        actionId,
        PendingActionStatus.FAILED,
        { error: message },
      );
      await this.log(
        action.ticketId,
        agent,
        `Duyệt nhưng thực hiện thất bại: ${message}`,
      );
      throw new ConflictException(`Không thực hiện được đề xuất: ${message}`);
    }
  }

  async reject(agent: AuthUser, actionId: string, note?: string) {
    const action = await this.tickets.findPendingAction(actionId);
    if (!action) throw new NotFoundException('Không tìm thấy đề xuất');
    const claimed = await this.tickets.claimPendingAction(
      actionId,
      agent.id,
      PendingActionStatus.REJECTED,
    );
    if (!claimed) {
      throw new ConflictException('Đề xuất này đã được xử lý trước đó');
    }
    await this.tickets.finishPendingAction(
      actionId,
      PendingActionStatus.REJECTED,
      { note: note ?? null },
    );
    await this.log(
      action.ticketId,
      agent,
      `Từ chối đề xuất: ${describe(action.payload)}`,
    );
    return { id: actionId, status: PendingActionStatus.REJECTED };
  }

  private async execute(
    action: { actionType: string; payload: unknown; id: string },
    agent: AuthUser,
    note?: string,
  ) {
    if (action.actionType !== CANCEL_ORDER) {
      throw new Error(`Loại đề xuất không hỗ trợ: ${action.actionType}`);
    }
    const { orderId } = action.payload as { orderId: string };
    const order = await this.orders.changeStatusByStaff(
      agent,
      orderId,
      OrderStatus.CANCELLED,
      note ??
        `Huỷ theo đề xuất AI #${action.id.slice(0, 8)}, đã được CSKH duyệt`,
    );
    return { orderId: order.id, orderCode: order.code, status: order.status };
  }

  private log(ticketId: string, agent: AuthUser, content: string) {
    return this.tickets.addMessage({
      ticketId,
      authorType: MessageAuthor.SYSTEM,
      authorId: agent.id,
      content,
      internal: true,
    });
  }
}

function describe(payload: unknown): string {
  const p = payload as { orderCode?: string };
  return p?.orderCode ? `huỷ đơn ${p.orderCode}` : 'thao tác';
}
