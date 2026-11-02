import { Badge } from '@mantine/core';
import type { OrderStatus } from '../api/types';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from '../lib/format';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge color={ORDER_STATUS_COLOR[status]} variant="light">
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}
