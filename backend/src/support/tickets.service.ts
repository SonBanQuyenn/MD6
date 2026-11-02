import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ClassifiedBy,
  MessageAuthor,
  Prisma,
  Role,
  TicketStatus,
} from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import { JobsProducer } from '../jobs/jobs.producer';
import { OrdersService } from '../orders/orders.service';
import {
  AddMessageDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  UpdateTicketDto,
} from './dto/support.dto';
import {
  toCustomerTicketView,
  toStaffTicketView,
  toTicketSummary,
} from './support.mapper';
import { TicketClassifierService } from './ticket-classifier.service';
import { TicketDetail, TicketsRepository } from './tickets.repository';

const STAFF: Role[] = [Role.SUPPORT_AGENT, Role.ADMIN];

/** Nghiệp vụ ticket hỗ trợ: khách tạo / nhắn; nhân viên xem, trả lời, đổi trạng thái, phân loại. */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly orders: OrdersService,
    private readonly jobs: JobsProducer,
    private readonly classifier: TicketClassifierService,
  ) {}

  async create(customer: AuthUser, dto: CreateTicketDto) {
    if (dto.orderId) {
      // Khách chỉ gắn được đơn của chính mình (getForUser trả 404 nếu không phải)
      await this.orders.getForUser(customer, dto.orderId);
    }
    const ticket = await this.tickets.createWithMessage({
      customerId: customer.id,
      orderId: dto.orderId,
      subject: dto.subject,
      content: dto.message,
    });
    await this.scheduleClassification(ticket.id);
    return toCustomerTicketView(
      (await this.tickets.findById(ticket.id)) ?? ticket,
    );
  }

  /**
   * Phân loại chạy nền ở worker (khách không phải chờ AI).
   * Hàng đợi lỗi → phân loại ngay tại API (AI hoặc từ khoá dự phòng) để ticket không bị bỏ sót.
   */
  private async scheduleClassification(ticketId: string) {
    try {
      await this.jobs.classifyTicket(ticketId);
    } catch (error) {
      this.logger.warn(
        `Không đẩy được job phân loại ticket ${ticketId}, phân loại trực tiếp: ${String(error)}`,
      );
      await this.classifier.classify(ticketId).catch(() => undefined);
    }
  }

  async listMine(customer: AuthUser, query: ListTicketsQueryDto) {
    return this.list({ ...query, customerId: customer.id });
  }

  async listAll(query: ListTicketsQueryDto) {
    return this.list(query);
  }

  async getForUser(user: AuthUser, id: string) {
    const ticket = await this.load(user, id);
    return STAFF.includes(user.role)
      ? toStaffTicketView(ticket)
      : toCustomerTicketView(ticket);
  }

  async addMessage(user: AuthUser, id: string, dto: AddMessageDto) {
    const ticket = await this.load(user, id);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Ticket đã đóng, vui lòng tạo ticket mới');
    }
    const isStaff = STAFF.includes(user.role);
    await this.tickets.addMessage({
      ticketId: id,
      authorType: isStaff ? MessageAuthor.AGENT : MessageAuthor.CUSTOMER,
      authorId: user.id,
      content: dto.content,
    });

    const update: Prisma.TicketUncheckedUpdateInput = {};
    if (isStaff) {
      // Nhân viên trả lời lần đầu → nhận ticket, chuyển "đang xử lý"
      if (ticket.status === TicketStatus.OPEN) {
        update.status = TicketStatus.IN_PROGRESS;
      }
      if (!ticket.assignedAgentId) update.assignedAgentId = user.id;
    } else if (ticket.status === TicketStatus.RESOLVED) {
      update.status = TicketStatus.OPEN; // khách nhắn tiếp → mở lại
    }
    if (Object.keys(update).length > 0) await this.tickets.update(id, update);
    return this.getForUser(user, id);
  }

  async update(agent: AuthUser, id: string, dto: UpdateTicketDto) {
    await this.load(agent, id);
    const data: Prisma.TicketUncheckedUpdateInput = {};
    if (dto.status) data.status = dto.status;
    if (dto.category) {
      data.category = dto.category;
      data.classifiedBy = ClassifiedBy.HUMAN;
      data.categoryConfidence = 1;
    }
    if (Object.keys(data).length > 0) await this.tickets.update(id, data);
    return this.getForUser(agent, id);
  }

  /** Khách chỉ thấy ticket của mình (404 nếu không phải — không lộ id ticket người khác). */
  async load(user: AuthUser, id: string): Promise<TicketDetail> {
    const ticket = await this.tickets.findById(id);
    if (
      !ticket ||
      (!STAFF.includes(user.role) && ticket.customerId !== user.id)
    ) {
      throw new NotFoundException('Không tìm thấy ticket');
    }
    return ticket;
  }

  private async list(query: ListTicketsQueryDto & { customerId?: string }) {
    const { page, limit } = query;
    const { items, total } = await this.tickets.findMany({
      customerId: query.customerId,
      status: query.status,
      category: query.category,
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: items.map(toTicketSummary),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
