import {
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adjustInventory,
  fetchAllOrders,
  fetchLowStock,
  fetchProducts,
} from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { OrderStatusBadge } from '../../components/OrderStatusBadge';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
} from '../../components/States';
import {
  formatDateTime,
  formatVnd,
  ORDER_STATUS_LABEL,
} from '../../lib/format';
import { notifyError, notifySuccess } from '../../lib/notify';
import { StaffStatusButtons } from './StaffStatusButtons';

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  ...(
    [
      'PENDING',
      'CONFIRMED',
      'PACKING',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
    ] as const
  ).map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] })),
];

/** Kho / quản trị: xem mọi đơn và cập nhật trạng thái (F06.3). CSKH: chỉ xem. */
export function WarehouseOrdersPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('WAREHOUSE_STAFF', 'ADMIN');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const orders = useQuery({
    queryKey: ['staff-orders', page, status],
    queryFn: () => fetchAllOrders({ page, status: status || undefined }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  return (
    <Stack>
      <Title order={2}>Quản lý đơn hàng</Title>
      <Select
        label="Trạng thái"
        data={STATUS_FILTERS}
        value={status}
        onChange={(v) => {
          setStatus(v ?? '');
          setPage(1);
        }}
        maw={240}
      />
      {orders.isPending && <LoadingState />}
      {orders.isError && (
        <ErrorState error={orders.error} onRetry={orders.refetch} />
      )}
      {orders.data?.items.length === 0 && (
        <EmptyState title="Không có đơn nào" />
      )}
      {orders.data && orders.data.items.length > 0 && (
        <Card withBorder p={0}>
          <Table.ScrollContainer minWidth={820}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mã đơn</Table.Th>
                  <Table.Th>Người nhận</Table.Th>
                  <Table.Th>Tổng</Table.Th>
                  <Table.Th>Trạng thái</Table.Th>
                  <Table.Th>Đặt lúc</Table.Th>
                  {canManage && <Table.Th>Cập nhật</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {orders.data.items.map((o) => (
                  <Table.Tr key={o.id}>
                    <Table.Td>
                      <Text component={Link} to={`/orders/${o.id}`} fw={600}>
                        {o.code}
                      </Text>
                    </Table.Td>
                    <Table.Td>{o.shippingAddress.fullName}</Table.Td>
                    <Table.Td>{formatVnd(o.total)}</Table.Td>
                    <Table.Td>
                      <OrderStatusBadge status={o.status} />
                    </Table.Td>
                    <Table.Td>{formatDateTime(o.createdAt)}</Table.Td>
                    {canManage && (
                      <Table.Td>
                        <StaffStatusButtons order={o} size="xs" />
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {orders.data && (
        <Pager
          page={page}
          totalPages={orders.data.totalPages}
          onChange={setPage}
        />
      )}
    </Stack>
  );
}

/** Kho: sản phẩm sắp hết + nhập / xuất kho. Đổi tồn kho → cache sản phẩm được làm mới ngay (F04.2). */
export function InventoryPage() {
  const [page, setPage] = useState(1);
  const [threshold, setThreshold] = useState(10);
  const [target, setTarget] = useState<{
    productId: string;
    name: string;
  } | null>(null);
  const [opened, { open, close }] = useDisclosure();
  const lowStock = useQuery({
    queryKey: ['low-stock', page, threshold],
    queryFn: () => fetchLowStock({ page, threshold }),
    placeholderData: keepPreviousData,
  });

  const openAdjust = (t: { productId: string; name: string } | null) => {
    setTarget(t);
    open();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Tồn kho</Title>
        <Button onClick={() => openAdjust(null)}>Nhập / xuất kho</Button>
      </Group>
      <NumberInput
        label="Ngưỡng sắp hết (≤)"
        min={0}
        max={10000}
        value={threshold}
        onChange={(v) => {
          setThreshold(Number(v) || 0);
          setPage(1);
        }}
        maw={200}
      />
      {lowStock.isPending && <LoadingState />}
      {lowStock.isError && (
        <ErrorState error={lowStock.error} onRetry={lowStock.refetch} />
      )}
      {lowStock.data?.items.length === 0 && (
        <EmptyState title="Không có sản phẩm nào dưới ngưỡng" />
      )}
      {lowStock.data && lowStock.data.items.length > 0 && (
        <Card withBorder p={0}>
          <Table.ScrollContainer minWidth={520}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>SKU</Table.Th>
                  <Table.Th>Sản phẩm</Table.Th>
                  <Table.Th>Tồn</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lowStock.data.items.map((s) => (
                  <Table.Tr key={s.productId}>
                    <Table.Td>{s.sku}</Table.Td>
                    <Table.Td>{s.name}</Table.Td>
                    <Table.Td c={s.stock === 0 ? 'red' : undefined} fw={600}>
                      {s.stock}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => openAdjust(s)}
                      >
                        Điều chỉnh
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {lowStock.data && (
        <Pager
          page={page}
          totalPages={lowStock.data.totalPages}
          onChange={setPage}
        />
      )}
      <AdjustModal opened={opened} onClose={close} preset={target} />
    </Stack>
  );
}

function AdjustModal({
  opened,
  onClose,
  preset,
}: {
  opened: boolean;
  onClose: () => void;
  preset: { productId: string; name: string } | null;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [productId, setProductId] = useState<string | null>(null);
  const [mode, setMode] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState('');
  const options = useQuery({
    queryKey: ['product-search', debounced],
    queryFn: () => fetchProducts({ q: debounced || undefined, limit: 20 }),
    enabled: opened && !preset,
  });
  const selectedId = preset?.productId ?? productId;

  const mutation = useMutation({
    mutationFn: () =>
      adjustInventory({
        productId: selectedId!,
        delta: mode === 'in' ? amount : -amount,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      notifySuccess('Đã cập nhật tồn kho');
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setNote('');
      onClose();
    },
    onError: (e) => notifyError(e),
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Nhập / xuất kho">
      <Stack>
        {preset ? (
          <Text fw={600}>{preset.name}</Text>
        ) : (
          <Select
            label="Sản phẩm"
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Gõ tên sản phẩm…"
            data={
              options.data?.items.map((p) => ({
                value: p.id,
                label: `${p.sku} — ${p.name} (tồn ${p.stock})`,
              })) ?? []
            }
            value={productId}
            onChange={setProductId}
            filter={({ options: all }) => all}
          />
        )}
        <SegmentedControl
          data={[
            { value: 'in', label: 'Nhập kho (+)' },
            { value: 'out', label: 'Xuất kho (−)' },
          ]}
          value={mode}
          onChange={(v) => setMode(v as 'in' | 'out')}
        />
        <NumberInput
          label="Số lượng"
          min={1}
          max={100000}
          value={amount}
          onChange={(v) => setAmount(Number(v) || 1)}
        />
        <TextInput
          label="Ghi chú"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        <Button
          disabled={!selectedId}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Xác nhận
        </Button>
      </Stack>
    </Modal>
  );
}
