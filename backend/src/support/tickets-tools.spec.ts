import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductsService } from '../catalog/products/products.service';
import { AuthUser } from '../common/types/auth-user';
import { JobsProducer } from '../jobs/jobs.producer';
import { OrdersService } from '../orders/orders.service';
import { SupportTools } from './support-tools';
import { TicketClassifierService } from './ticket-classifier.service';
import { TicketDetail, TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

const customer: AuthUser = { id: 'c1', email: 'c@x.com', role: Role.CUSTOMER };
const other: AuthUser = { id: 'c2', email: 'o@x.com', role: Role.CUSTOMER };
const agent: AuthUser = {
  id: 'a1',
  email: 'a@x.com',
  role: Role.SUPPORT_AGENT,
};

const ticket = (overrides: Partial<TicketDetail> = {}) =>
  ({
    id: 't1',
    customerId: 'c1',
    subject: 'Hỏi đơn',
    status: 'OPEN',
    category: null,
    categoryConfidence: null,
    classifiedBy: null,
    assignedAgentId: null,
    orderId: null,
    order: null,
    customer: { id: 'c1', email: 'c@x.com', fullName: 'Khách' },
    assignedAgent: null,
    messages: [
      {
        id: 'm1',
        authorType: 'CUSTOMER',
        content: 'Xin chào',
        internal: false,
        createdAt: new Date(),
      },
      {
        id: 'm2',
        authorType: 'AI',
        content: 'nội bộ',
        internal: true,
        createdAt: new Date(),
      },
    ],
    toolCalls: [],
    pendingActions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as unknown as TicketDetail;

describe('TicketsService', () => {
  let repo: {
    createWithMessage: jest.Mock;
    findById: jest.Mock;
    findMany: jest.Mock;
    addMessage: jest.Mock;
    update: jest.Mock;
  };
  let orders: { getForUser: jest.Mock };
  let jobs: { classifyTicket: jest.Mock };
  let classifier: { classify: jest.Mock };
  let service: TicketsService;

  beforeEach(() => {
    repo = {
      createWithMessage: jest.fn().mockResolvedValue(ticket()),
      findById: jest.fn().mockResolvedValue(ticket()),
      findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      addMessage: jest.fn(),
      update: jest.fn(),
    };
    orders = { getForUser: jest.fn() };
    jobs = { classifyTicket: jest.fn() };
    classifier = { classify: jest.fn().mockResolvedValue({}) };
    service = new TicketsService(
      repo as unknown as TicketsRepository,
      orders as unknown as OrdersService,
      jobs as unknown as JobsProducer,
      classifier as unknown as TicketClassifierService,
    );
  });

  it('tạo ticket kèm đơn → kiểm tra đơn thuộc về khách, đẩy job phân loại', async () => {
    await service.create(customer, {
      subject: 'Hỏi',
      message: 'Nội dung dài',
      orderId: 'o1',
    });
    expect(orders.getForUser).toHaveBeenCalledWith(customer, 'o1');
    expect(jobs.classifyTicket).toHaveBeenCalledWith('t1');
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('hàng đợi lỗi → phân loại ngay tại API (không bỏ sót ticket)', async () => {
    jobs.classifyTicket.mockRejectedValue(new Error('redis down'));
    await service.create(customer, { subject: 'Hỏi', message: 'Nội dung dài' });
    expect(classifier.classify).toHaveBeenCalledWith('t1');
  });

  it('khách xem ticket: ẩn tin nhắn nội bộ; nhân viên xem: đầy đủ', async () => {
    const forCustomer = await service.getForUser(customer, 't1');
    expect(forCustomer.messages).toHaveLength(1);
    expect('toolCalls' in forCustomer).toBe(false);
    const forAgent = await service.getForUser(agent, 't1');
    expect(forAgent.messages).toHaveLength(2);
  });

  it('khách khác xem ticket → 404', async () => {
    await expect(service.getForUser(other, 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('nhân viên trả lời lần đầu → IN_PROGRESS + nhận ticket', async () => {
    await service.addMessage(agent, 't1', { content: 'Chào anh' });
    expect(repo.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorType: 'AGENT' }),
    );
    expect(repo.update).toHaveBeenCalledWith('t1', {
      status: 'IN_PROGRESS',
      assignedAgentId: 'a1',
    });
  });

  it('khách nhắn vào ticket đã giải quyết → mở lại', async () => {
    repo.findById.mockResolvedValue(ticket({ status: 'RESOLVED' }));
    await service.addMessage(customer, 't1', { content: 'Vẫn chưa nhận' });
    expect(repo.update).toHaveBeenCalledWith('t1', { status: 'OPEN' });
  });

  it('ticket đã đóng → không nhắn thêm được', async () => {
    repo.findById.mockResolvedValue(ticket({ status: 'CLOSED' }));
    await expect(
      service.addMessage(customer, 't1', { content: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('phân loại tay → classifiedBy HUMAN, độ tin cậy 1', async () => {
    await service.update(agent, 't1', { category: 'PAYMENT' });
    expect(repo.update).toHaveBeenCalledWith('t1', {
      category: 'PAYMENT',
      classifiedBy: 'HUMAN',
      categoryConfidence: 1,
    });
  });

  it('danh sách của khách chỉ lọc theo customerId của chính khách', async () => {
    await service.listMine(customer, { page: 2, limit: 10 } as never);
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'c1', skip: 10, take: 10 }),
    );
  });
});

describe('SupportTools', () => {
  const ctx = { ticketId: 't1', ticketCustomerId: 'c1', agentId: 'a1' };
  let orders: { findForSupport: jest.Mock };
  let products: { findForSupport: jest.Mock };
  let repo: { recordToolCall: jest.Mock; createPendingAction: jest.Mock };
  let tools: SupportTools;

  const order = (overrides = {}) => ({
    id: 'o1',
    userId: 'c1',
    code: 'SF-20261102-AAAAAAAA',
    status: 'PENDING',
    statusLabel: 'Chờ xác nhận',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    total: 100,
    items: [{ productName: 'A', sku: 'A1', quantity: 1 }],
    statusHistory: [],
    createdAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    orders = { findForSupport: jest.fn().mockResolvedValue(order()) };
    products = { findForSupport: jest.fn() };
    repo = {
      recordToolCall: jest.fn(),
      createPendingAction: jest.fn().mockResolvedValue({ id: 'pa1' }),
    };
    tools = new SupportTools(
      orders as unknown as OrdersService,
      products as unknown as ProductsService,
      repo as unknown as TicketsRepository,
    );
  });

  const run = (name: string, input: Record<string, unknown>) =>
    tools.execute({ id: 'call1', name, input }, ctx);

  it('khai báo 3 tool, schema chặt (additionalProperties: false)', () => {
    const defs = tools.definitions();
    expect(defs.map((d) => d.name)).toEqual([
      'get_order_status',
      'check_product_inventory',
      'propose_cancel_order',
    ]);
    defs.forEach((d) =>
      expect(d.inputSchema).toMatchObject({ additionalProperties: false }),
    );
  });

  it('get_order_status: dữ liệu thật + cờ đơn có thuộc khách của ticket', async () => {
    const { result, record } = await run('get_order_status', { order: 'SF-1' });
    expect(record.output).toMatchObject({
      found: true,
      code: 'SF-20261102-AAAAAAAA',
      belongsToTicketCustomer: true,
    });
    expect(result.isError).toBe(false);
    expect(repo.recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'get_order_status', success: true }),
    );
  });

  it('get_order_status: đơn của người khác → belongsToTicketCustomer = false', async () => {
    orders.findForSupport.mockResolvedValue(order({ userId: 'c2' }));
    const { record } = await run('get_order_status', { order: 'SF-1' });
    expect(record.output.belongsToTicketCustomer).toBe(false);
  });

  it('không tìm thấy → found=false (không bịa)', async () => {
    orders.findForSupport.mockResolvedValue(null);
    const { record } = await run('get_order_status', { order: 'SF-X' });
    expect(record.output).toEqual({ found: false, query: 'SF-X' });
  });

  it('check_product_inventory: trả tồn kho thật', async () => {
    products.findForSupport.mockResolvedValue({
      id: 'p1',
      sku: 'MX',
      name: 'Chuột',
      stock: 5,
      inStock: true,
      isActive: true,
      price: 10,
    });
    const { record } = await run('check_product_inventory', { product: 'MX' });
    expect(record.output).toMatchObject({ found: true, stock: 5 });
  });

  it('propose_cancel_order: chỉ TẠO đề xuất, không huỷ đơn', async () => {
    const { record } = await run('propose_cancel_order', {
      order: 'SF-1',
      reason: 'Khách đổi ý',
    });
    expect(record.output).toMatchObject({
      created: true,
      pendingActionId: 'pa1',
      status: 'PENDING_HUMAN_APPROVAL',
    });
    expect(repo.createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'CANCEL_ORDER' }),
    );
  });

  it('propose_cancel_order: đơn không thuộc khách / đã giao → không tạo đề xuất', async () => {
    orders.findForSupport.mockResolvedValue(order({ userId: 'c2' }));
    expect(
      (await run('propose_cancel_order', { order: 'x', reason: 'r' })).record
        .output.created,
    ).toBe(false);
    orders.findForSupport.mockResolvedValue(
      order({ status: 'DELIVERED', statusLabel: 'Đã giao' }),
    );
    expect(
      (await run('propose_cancel_order', { order: 'x', reason: 'r' })).record
        .output.created,
    ).toBe(false);
    expect(repo.createPendingAction).not.toHaveBeenCalled();
  });

  it('tham số sai / tool lạ / service lỗi → is_error, vẫn ghi nhật ký, không ném lỗi', async () => {
    for (const [name, input] of [
      ['get_order_status', { order: '' }],
      ['khong_co_tool', {}],
    ] as const) {
      const { result, record } = await run(name, input);
      expect(result.isError).toBe(true);
      expect(record.success).toBe(false);
    }
    orders.findForSupport.mockRejectedValue(new Error('db down'));
    expect(
      (await run('get_order_status', { order: 'SF-1' })).result.isError,
    ).toBe(true);
    expect(repo.recordToolCall).toHaveBeenCalledTimes(3);
  });
});
