import { api } from './client';
import type {
  AssistantAnswer,
  CacheMetrics,
  Cart,
  FailedJob,
  Order,
  OrderStatus,
  Paginated,
  Product,
  QueueStats,
  RevenueReport,
  Role,
  ShippingAddress,
  StockLevel,
  Taxonomy,
  Ticket,
  User,
} from './types';

/** Tất cả lời gọi API ở một chỗ — trang chỉ gọi hàm, không tự viết URL. */

const get = async <T>(url: string, params?: object) =>
  (await api.get<T>(url, { params })).data;

// ---------- Sản phẩm ----------
export interface ProductQuery {
  categoryId?: string;
  brandId?: string;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  sort?: string;
  page?: number;
  limit?: number;
}
export const fetchProducts = (query: ProductQuery) =>
  get<Paginated<Product>>('/products', query);
export const fetchProduct = (id: string) => get<Product>(`/products/${id}`);
export const fetchCategories = () => get<Taxonomy[]>('/categories');
export const fetchBrands = () => get<Taxonomy[]>('/brands');
export const createProduct = async (body: Record<string, unknown>) =>
  (await api.post<Product>('/products', body)).data;
export const updateProduct = async (
  id: string,
  body: Record<string, unknown>,
) => (await api.patch<Product>(`/products/${id}`, body)).data;
export const deactivateProduct = (id: string) => api.delete(`/products/${id}`);

// ---------- Giỏ hàng ----------
export const fetchCart = () => get<Cart>('/cart');
export const addToCart = async (productId: string, quantity = 1) =>
  (await api.post<Cart>('/cart/items', { productId, quantity })).data;
export const updateCartItem = async (productId: string, quantity: number) =>
  (await api.patch<Cart>(`/cart/items/${productId}`, { quantity })).data;
export const removeCartItem = async (productId: string) =>
  (await api.delete<Cart>(`/cart/items/${productId}`)).data;

// ---------- Đơn hàng ----------
export interface PlaceOrderInput {
  paymentMethod: 'COD' | 'MOCK_ONLINE';
  shippingAddress: ShippingAddress;
  note?: string;
  promotionCode?: string;
}
/** Idempotency-Key tạo 1 lần cho mỗi lần bấm "Đặt hàng" → bấm 2 lần không tạo 2 đơn. */
export const placeOrder = async (
  input: PlaceOrderInput,
  idempotencyKey: string,
) => {
  const { promotionCode, ...body } = input;
  const url = promotionCode ? '/orders/promotional' : '/orders';
  return (
    await api.post<Order>(
      url,
      promotionCode ? { ...body, promotionCode } : body,
      {
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    )
  ).data;
};
export const fetchMyOrders = (params: { page: number; status?: string }) =>
  get<Paginated<Order>>('/orders/me', { ...params, limit: 10 });
export const fetchAllOrders = (params: { page: number; status?: string }) =>
  get<Paginated<Order>>('/orders', { ...params, limit: 20 });
export const fetchOrder = (id: string) => get<Order>(`/orders/${id}`);
/** Hoá đơn HTML do job nền tạo (404 khi chưa tạo xong). */
export const fetchInvoiceHtml = async (id: string) =>
  (await api.get<string>(`/orders/${id}/invoice`, { responseType: 'text' }))
    .data;
export const cancelOrder = async (id: string) =>
  (await api.post<Order>(`/orders/${id}/cancel`)).data;
export const payOrder = async (id: string) =>
  (await api.post<Order>(`/orders/${id}/pay`)).data;
export const changeOrderStatus = async (
  id: string,
  status: OrderStatus,
  note?: string,
) => (await api.patch<Order>(`/orders/${id}/status`, { status, note })).data;

// ---------- Tồn kho ----------
export const fetchLowStock = (params: { page: number; threshold?: number }) =>
  get<Paginated<StockLevel>>('/inventory/low-stock', { ...params, limit: 20 });
export const adjustInventory = async (body: {
  productId: string;
  delta: number;
  note?: string;
}) => (await api.post('/inventory/adjustments', body)).data;

// ---------- Hỗ trợ ----------
export const createTicket = async (body: {
  subject: string;
  message: string;
  orderId?: string;
}) => (await api.post<Ticket>('/support/tickets', body)).data;
export const fetchMyTickets = (page: number) =>
  get<Paginated<Ticket>>('/support/tickets/me', { page, limit: 10 });
export const fetchTickets = (params: {
  page: number;
  status?: string;
  category?: string;
}) => get<Paginated<Ticket>>('/support/tickets', { ...params, limit: 20 });
export const fetchTicket = (id: string) =>
  get<Ticket>(`/support/tickets/${id}`);
export const sendTicketMessage = async (id: string, content: string) =>
  (await api.post<Ticket>(`/support/tickets/${id}/messages`, { content })).data;
export const updateTicket = async (
  id: string,
  body: { status?: string; category?: string },
) => (await api.patch<Ticket>(`/support/tickets/${id}`, body)).data;
export const askAssistant = async (id: string, question: string) =>
  (
    await api.post<AssistantAnswer>(`/support/tickets/${id}/assistant`, {
      question,
    })
  ).data;
export const approveAction = async (id: string) =>
  (await api.post(`/support/actions/${id}/approve`, {})).data;
export const rejectAction = async (id: string, note?: string) =>
  (await api.post(`/support/actions/${id}/reject`, { note })).data;

// ---------- Xác thực bổ sung ----------
export const requestVerificationCode = async (
  email: string,
  purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD',
) =>
  (
    await api.post<{ message: string }>('/auth/verification-code', {
      email,
      purpose,
    })
  ).data;
export const resetPassword = async (body: {
  email: string;
  code: string;
  newPassword: string;
}) => (await api.post<{ message: string }>('/auth/reset-password', body)).data;

// ---------- Quản trị ----------
export const fetchUsers = (params: { page: number; role?: string }) =>
  get<Paginated<User>>('/users', { ...params, limit: 20 });
export const changeUserRole = async (id: string, role: Role) =>
  (await api.patch<User>(`/users/${id}/role`, { role })).data;
export const changeUserStatus = async (id: string, isActive: boolean) =>
  (await api.patch<User>(`/users/${id}/status`, { isActive })).data;
export const fetchQueueStats = () =>
  get<{ queues: QueueStats[]; outboxPending: number }>('/admin/queues');
export const fetchFailedJobs = (page: number) =>
  get<Paginated<FailedJob>>('/admin/jobs/failed', { page, limit: 20 });
export const retryFailedJob = async (id: string) =>
  (await api.post(`/admin/jobs/failed/${id}/retry`)).data;
export const fetchCacheMetrics = () =>
  get<CacheMetrics>('/admin/metrics/cache');
export const fetchRevenueReports = () =>
  get<RevenueReport[]>('/admin/reports/daily-revenue');
export const triggerRevenueReport = async (date?: string) =>
  (await api.post('/admin/reports/daily-revenue', date ? { date } : {})).data;
