import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketClassifierService } from '../src/support/ticket-classifier.service';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

/**
 * Integration test F01 — chạy với AI_PROVIDER=mock (mặc định khi test): KHÔNG gọi AI thật,
 * nhưng tool, guardrail, lưu lịch sử và bước duyệt của con người đều chạy trên DB thật.
 */
describe('Support tickets & AI assistant (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let customer: string;
  let otherCustomer: string;
  let agent: string;
  let customerId: string;
  let orderId: string;
  let orderCode: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const c = await createUser(prisma, Role.CUSTOMER, 'kh@example.com');
    const o = await createUser(prisma, Role.CUSTOMER, 'khac@example.com');
    const a = await createUser(prisma, Role.SUPPORT_AGENT, 'cs@example.com');
    customerId = c.id;
    customer = (await loginAs(app, c.email)).accessToken;
    otherCustomer = (await loginAs(app, o.email)).accessToken;
    agent = (await loginAs(app, a.email)).accessToken;

    const category = await prisma.category.create({
      data: { name: 'Chuột', slug: 'chuot' },
    });
    const brand = await prisma.brand.create({
      data: { name: 'Logitech', slug: 'logitech' },
    });
    const product = await prisma.product.create({
      data: {
        sku: 'MX-3S',
        name: 'Chuột MX Master 3S',
        slug: 'mx-3s',
        price: 2_000_000,
        stock: 17,
        categoryId: category.id,
        brandId: brand.id,
      },
    });
    await http()
      .post('/api/cart/items')
      .set(auth(customer))
      .send({ productId: product.id, quantity: 1 })
      .expect(201);
    const res = await http()
      .post('/api/orders')
      .set(auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        paymentMethod: 'COD',
        shippingAddress: {
          fullName: 'Nguyễn Văn A',
          phone: '0912345678',
          addressLine: '1 Lê Lợi',
          city: 'Hà Nội',
        },
      })
      .expect(201);
    orderId = res.body.id;
    orderCode = res.body.code;
  });

  afterAll(async () => {
    await app.close();
  });

  const createTicket = (token = customer, body: object = {}) =>
    http()
      .post('/api/support/tickets')
      .set(auth(token))
      .send({
        subject: 'Hỏi về đơn hàng',
        message: 'Đơn hàng của tôi bao giờ giao vậy shop?',
        orderId,
        ...body,
      });

  const ask = (ticketId: string, question: string, token = agent) =>
    http()
      .post(`/api/support/tickets/${ticketId}/assistant`)
      .set(auth(token))
      .send({ question });

  it('khách tạo ticket → job phân loại vào hàng đợi; worker phân loại (dự phòng khi MOCK)', async () => {
    const res = await createTicket().expect(201);
    const queue = app.get<Queue>(getQueueToken('support'));
    const job = await queue.getJob(`classify-ticket-${res.body.id}`);
    expect(job?.data).toEqual({ ticketId: res.body.id });

    // Chạy đúng code mà worker chạy cho job này
    await app.get(TicketClassifierService).classify(res.body.id);
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(ticket.category).toBe('ORDER_STATUS');
    expect(ticket.classifiedBy).toBe('FALLBACK');
  });

  it('khách không gắn được đơn của người khác vào ticket', async () => {
    await createTicket(otherCustomer).expect(404);
  });

  it('khách không gọi được trợ lý AI; không xem được ticket người khác', async () => {
    const ticket = (await createTicket().expect(201)).body;
    await ask(ticket.id, `Đơn ${orderCode}?`, customer).expect(403);
    await http()
      .get(`/api/support/tickets/${ticket.id}`)
      .set(auth(otherCustomer))
      .expect(404);
  });

  it('trợ lý tra cứu đơn THẬT bằng tool, ghi nhật ký tool, gắn nhãn mock', async () => {
    const ticket = (await createTicket().expect(201)).body;
    const res = await ask(ticket.id, `Kiểm tra đơn ${orderCode}`).expect(200);

    expect(res.body.mock).toBe(true);
    expect(res.body.answer).toContain('MOCK AI');
    expect(res.body.answer).toContain('Chờ xác nhận'); // trạng thái thật trong DB
    expect(res.body.toolCalls[0]).toMatchObject({
      name: 'get_order_status',
      success: true,
      output: { found: true, code: orderCode, belongsToTicketCustomer: true },
    });
    const logged = await prisma.aiToolCall.findMany({
      where: { ticketId: ticket.id },
    });
    expect(logged).toHaveLength(1);
  });

  it('tool kiểm tra tồn kho trả số thật từ DB', async () => {
    const ticket = (await createTicket().expect(201)).body;
    const res = await ask(
      ticket.id,
      'Sản phẩm SKU MX-3S còn hàng không?',
    ).expect(200);
    expect(res.body.toolCalls[0].output).toMatchObject({
      found: true,
      sku: 'MX-3S',
      stock: 16, // 17 ban đầu − 1 khách vừa đặt
    });
  });

  it('câu hỏi ngoài phạm vi → từ chối, không gọi tool', async () => {
    const ticket = (await createTicket().expect(201)).body;
    const res = await ask(ticket.id, 'Viết giúp tôi bài thơ về mùa thu').expect(
      200,
    );
    expect(res.body.toolCalls).toEqual([]);
    expect(res.body.answer).toMatch(/chỉ hỗ trợ/);
  });

  it('hội thoại với AI là NỘI BỘ: nhân viên thấy, khách không thấy', async () => {
    const ticket = (await createTicket().expect(201)).body;
    await ask(ticket.id, `Kiểm tra đơn ${orderCode}`).expect(200);

    const staffView = await http()
      .get(`/api/support/tickets/${ticket.id}`)
      .set(auth(agent))
      .expect(200);
    expect(staffView.body.messages.length).toBe(3);
    expect(staffView.body.toolCalls).toHaveLength(1);

    const customerView = await http()
      .get(`/api/support/tickets/${ticket.id}`)
      .set(auth(customer))
      .expect(200);
    expect(customerView.body.messages).toHaveLength(1);
    expect(customerView.body.toolCalls).toBeUndefined();
  });

  it('AI đề xuất huỷ đơn → đơn CHƯA đổi; nhân viên duyệt → mới huỷ; duyệt lần 2 → 409', async () => {
    const ticket = (await createTicket().expect(201)).body;
    const res = await ask(ticket.id, `Khách muốn huỷ đơn ${orderCode}`).expect(
      200,
    );
    expect(res.body.pendingActionIds).toHaveLength(1);
    const actionId = res.body.pendingActionIds[0];

    const before = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(before.status).toBe('PENDING'); // AI KHÔNG tự huỷ

    // Khách không duyệt được
    await http()
      .post(`/api/support/actions/${actionId}/approve`)
      .set(auth(customer))
      .send({})
      .expect(403);

    const approved = await http()
      .post(`/api/support/actions/${actionId}/approve`)
      .set(auth(agent))
      .send({})
      .expect(200);
    expect(approved.body.status).toBe('EXECUTED');
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(after.status).toBe('CANCELLED');

    await http()
      .post(`/api/support/actions/${actionId}/approve`)
      .set(auth(agent))
      .send({})
      .expect(409);
  });

  it('nhân viên từ chối đề xuất → đơn giữ nguyên', async () => {
    const ticket = (await createTicket().expect(201)).body;
    const res = await ask(ticket.id, `Huỷ đơn ${orderCode} giúp khách`).expect(
      200,
    );
    const actionId = res.body.pendingActionIds[0];
    await http()
      .post(`/api/support/actions/${actionId}/reject`)
      .set(auth(agent))
      .send({ note: 'Khách đổi ý' })
      .expect(200);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe('PENDING');
  });

  it('nhân viên trả lời → ticket chuyển IN_PROGRESS và được giao cho nhân viên đó; phân loại tay → HUMAN', async () => {
    const ticket = (await createTicket().expect(201)).body;
    const replied = await http()
      .post(`/api/support/tickets/${ticket.id}/messages`)
      .set(auth(agent))
      .send({ content: 'Chào anh, shop kiểm tra ngay ạ' })
      .expect(201);
    expect(replied.body.status).toBe('IN_PROGRESS');
    expect(replied.body.assignedAgent).not.toBeNull();

    const updated = await http()
      .patch(`/api/support/tickets/${ticket.id}`)
      .set(auth(agent))
      .send({ category: 'SHIPPING', status: 'RESOLVED' })
      .expect(200);
    expect(updated.body).toMatchObject({
      category: 'SHIPPING',
      classifiedBy: 'HUMAN',
      status: 'RESOLVED',
    });
  });
});
