/** Kiểu dữ liệu trả về từ backend (khớp với các mapper trong backend/src). */

export type Role = 'CUSTOMER' | 'SUPPORT_AGENT' | 'WAREHOUSE_STAFF' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Taxonomy {
  id: string;
  name: string;
  slug: string;
  productCount?: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  inStock: boolean;
  imageUrl: string | null;
  isActive: boolean;
  category: Taxonomy;
  brand: Taxonomy;
  createdAt: string;
  updatedAt: string;
}

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  available: boolean;
  availableStock: number;
  warning: string | null;
}

export interface Cart {
  items: CartLine[];
  itemCount: number;
  subtotal: number;
  canCheckout: boolean;
}

export type OrderStatus =
  'PENDING' | 'CONFIRMED' | 'PACKING' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';

export interface ShippingAddress {
  fullName: string;
  phone: string;
  addressLine: string;
  city: string;
}

export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  paymentMethod: 'COD' | 'MOCK_ONLINE';
  subtotal: number;
  discount: number;
  total: number;
  promotionCode: string | null;
  shippingAddress: ShippingAddress;
  note: string | null;
  items: {
    productId: string;
    productName: string;
    sku: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  statusHistory?: {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    note: string | null;
    at: string;
  }[];
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketCategory =
  | 'ORDER_STATUS'
  | 'SHIPPING'
  | 'PAYMENT'
  | 'RETURN_REFUND'
  | 'PRODUCT_INQUIRY'
  | 'ACCOUNT'
  | 'COMPLAINT'
  | 'OTHER';

export interface TicketMessage {
  id: string;
  authorType: 'CUSTOMER' | 'AGENT' | 'AI' | 'SYSTEM';
  authorId?: string | null;
  content: string;
  internal?: boolean;
  metadata?: { mock?: boolean; model?: string; tools?: string[] } | null;
  createdAt: string;
}

export interface ToolCallLog {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  createdAt: string;
}

export interface PendingAction {
  id: string;
  actionType: string;
  payload: { orderId?: string; orderCode?: string };
  reason: string;
  status: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'FAILED';
  result: Record<string, unknown> | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  categoryLabel: string | null;
  categoryConfidence: number | null;
  classifiedBy: 'AI' | 'FALLBACK' | 'HUMAN' | null;
  order: { id: string; code: string; status: OrderStatus } | null;
  customer: { id: string; email: string; fullName: string };
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  messages?: TicketMessage[];
  assignedAgent?: { id: string; fullName: string } | null;
  toolCalls?: ToolCallLog[];
  pendingActions?: PendingAction[];
}

export interface AssistantAnswer {
  answer: string;
  provider: string;
  model: string;
  mock: boolean;
  toolCalls: {
    name: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    success: boolean;
    durationMs: number;
  }[];
  pendingActionIds: string[];
  guardrail: { blocked: boolean; reason?: string };
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface FailedJob {
  id: string;
  queue: string;
  jobName: string;
  jobId: string;
  payload: unknown;
  failedReason: string;
  attemptsMade: number;
  retriedAt: string | null;
  failedAt: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  nullHits: number;
  errors: number;
  lockWaits: number;
  hitRatio: number;
  since: string;
}

export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  stock: number;
}

export interface RevenueReport {
  date: string;
  orderCount: number;
  cancelledCount: number;
  revenue: string;
}
