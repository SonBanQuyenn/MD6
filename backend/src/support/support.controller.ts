import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { AssistantService } from './assistant.service';
import {
  AddMessageDto,
  AskAssistantDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  ReviewActionDto,
  UpdateTicketDto,
} from './dto/support.dto';
import { PendingActionsService } from './pending-actions.service';
import { TicketsService } from './tickets.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Hỗ trợ & trợ lý AI')
@ApiBearerAuth()
@Controller('support')
export class SupportController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly assistant: AssistantService,
    private readonly actions: PendingActionsService,
  ) {}

  /** POST /api/support/tickets — khách gửi yêu cầu hỗ trợ (tự phân loại ở nền). */
  @Post('tickets')
  @Roles(Role.CUSTOMER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(user, dto);
  }

  /** GET /api/support/tickets/me — ticket của khách. (Khai báo trước ':id') */
  @Get('tickets/me')
  @Roles(Role.CUSTOMER)
  listMine(@CurrentUser() user: AuthUser, @Query() query: ListTicketsQueryDto) {
    return this.tickets.listMine(user, query);
  }

  /** GET /api/support/tickets — mọi ticket, lọc theo trạng thái / nhóm (CSKH). */
  @Get('tickets')
  @Roles(Role.SUPPORT_AGENT, Role.ADMIN)
  listAll(@Query() query: ListTicketsQueryDto) {
    return this.tickets.listAll(query);
  }

  /** GET /api/support/tickets/:id — khách: ticket của mình (ẩn nội bộ); CSKH: đầy đủ. */
  @Get('tickets/:id')
  @Roles(Role.CUSTOMER, Role.SUPPORT_AGENT, Role.ADMIN)
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.getForUser(user, id);
  }

  @Post('tickets/:id/messages')
  @Roles(Role.CUSTOMER, Role.SUPPORT_AGENT, Role.ADMIN)
  addMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMessageDto,
  ) {
    return this.tickets.addMessage(user, id, dto);
  }

  /** PATCH /api/support/tickets/:id — đổi trạng thái / phân loại tay. */
  @Patch('tickets/:id')
  @Roles(Role.SUPPORT_AGENT, Role.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.tickets.update(user, id, dto);
  }

  /** POST /api/support/tickets/:id/assistant — hỏi trợ lý AI (F01). */
  @Post('tickets/:id/assistant')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPPORT_AGENT, Role.ADMIN)
  async ask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskAssistantDto,
  ) {
    const ticket = await this.tickets.load(user, id);
    return this.assistant.ask(ticket, user, dto.question);
  }

  /** POST /api/support/actions/:id/approve — duyệt thao tác AI đề xuất → mới thực thi. */
  @Post('actions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPPORT_AGENT, Role.ADMIN)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewActionDto,
  ) {
    return this.actions.approve(user, id, dto.note);
  }

  @Post('actions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPPORT_AGENT, Role.ADMIN)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewActionDto,
  ) {
    return this.actions.reject(user, id, dto.note);
  }
}
