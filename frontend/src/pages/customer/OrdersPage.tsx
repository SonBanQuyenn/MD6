import {
  Button,
  Card,
  Group,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyOrders } from '../../api/endpoints';
import { OrderStatusBadge } from '../../components/OrderStatusBadge';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
} from '../../components/States';
import { formatDateTime, formatVnd } from '../../lib/format';

const FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING', label: 'Chờ xác nhận' },
  { value: 'SHIPPING', label: 'Đang giao' },
  { value: 'DELIVERED', label: 'Đã giao' },
  { value: 'CANCELLED', label: 'Đã huỷ' },
];

/** Lịch sử đơn hàng của khách (F06.3). */
export function OrdersPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const orders = useQuery({
    queryKey: ['my-orders', page, status],
    queryFn: () => fetchMyOrders({ page, status: status || undefined }),
    placeholderData: keepPreviousData,
  });

  return (
    <Stack>
      <Title order={2}>Đơn hàng của tôi</Title>
      <SegmentedControl
        data={FILTERS}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        style={{ alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}
      />
      {orders.isPending && <LoadingState />}
      {orders.isError && (
        <ErrorState error={orders.error} onRetry={orders.refetch} />
      )}
      {orders.data &&
        (orders.data.items.length === 0 ? (
          <EmptyState
            title="Chưa có đơn hàng"
            action={
              <Button component={Link} to="/products">
                Mua sắm ngay
              </Button>
            }
          />
        ) : (
          <Card withBorder p={0}>
            <Table.ScrollContainer minWidth={600}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Mã đơn</Table.Th>
                    <Table.Th>Ngày đặt</Table.Th>
                    <Table.Th>Trạng thái</Table.Th>
                    <Table.Th>Tổng tiền</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {orders.data.items.map((o) => (
                    <Table.Tr key={o.id}>
                      <Table.Td fw={600}>{o.code}</Table.Td>
                      <Table.Td>{formatDateTime(o.createdAt)}</Table.Td>
                      <Table.Td>
                        <OrderStatusBadge status={o.status} />
                      </Table.Td>
                      <Table.Td>{formatVnd(o.total)}</Table.Td>
                      <Table.Td>
                        <Group justify="flex-end">
                          <Button
                            size="xs"
                            variant="light"
                            component={Link}
                            to={`/orders/${o.id}`}
                          >
                            Theo dõi
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        ))}
      {orders.data && (
        <Pager
          page={page}
          totalPages={orders.data.totalPages}
          onChange={setPage}
        />
      )}
      <Text size="xs" c="dimmed">
        Trạng thái đơn được cập nhật theo thời gian thực ở trang theo dõi.
      </Text>
    </Stack>
  );
}
