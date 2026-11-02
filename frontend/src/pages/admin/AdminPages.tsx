import {
  Anchor,
  Button,
  Card,
  Code,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDatabase, IconRefresh, IconStack2 } from '@tabler/icons-react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import {
  changeUserRole,
  changeUserStatus,
  fetchCacheMetrics,
  fetchFailedJobs,
  fetchQueueStats,
  fetchRevenueReports,
  fetchUsers,
  retryFailedJob,
  triggerRevenueReport,
} from '../../api/endpoints';
import { fetchHealth } from '../../api/health';
import type { Role } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { StatTile, StatusPill } from '../../components/StatTile';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
} from '../../components/States';
import { formatDateTime, formatVnd, ROLE_LABEL } from '../../lib/format';
import { notifyError, notifySuccess } from '../../lib/notify';

const QUEUE_LABEL: Record<string, string> = {
  email: 'Email',
  invoice: 'Hoá đơn',
  'inventory-sync': 'Đồng bộ kho',
  scheduled: 'Định kỳ',
  support: 'Phân loại ticket',
};

/** Bảng điều khiển quản trị: sức khoẻ, hàng đợi, cache, doanh thu. */
export function AdminDashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });
  const queues = useQuery({
    queryKey: ['queues'],
    queryFn: fetchQueueStats,
    refetchInterval: 5_000,
  });
  const cache = useQuery({
    queryKey: ['cache-metrics'],
    queryFn: fetchCacheMetrics,
    refetchInterval: 10_000,
  });

  const totals = queues.data?.queues.reduce(
    (acc, q) => ({
      waiting: acc.waiting + q.waiting + q.delayed,
      active: acc.active + q.active,
      completed: acc.completed + q.completed,
      failed: acc.failed + q.failed,
    }),
    { waiting: 0, active: 0, completed: 0, failed: 0 },
  );

  return (
    <Stack>
      <Title order={2}>Bảng điều khiển</Title>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        <StatTile
          label="Hệ thống"
          value={
            health.data ? <StatusPill ok={health.data.status === 'ok'} /> : '—'
          }
          hint={
            health.data
              ? Object.entries(health.data.details)
                  .map(([k, v]) => `${k}: ${v.status}`)
                  .join(' · ')
              : 'Đang kiểm tra…'
          }
        />
        <StatTile
          label="Tỉ lệ trúng cache"
          value={
            cache.data ? `${(cache.data.hitRatio * 100).toFixed(1)}%` : '—'
          }
          hint={
            cache.data
              ? `${cache.data.hits} trúng · ${cache.data.misses} trượt · mục tiêu ≥ 80%`
              : undefined
          }
          icon={<IconDatabase size={22} />}
        />
        <StatTile
          label="Job đang chờ / chạy"
          value={totals ? `${totals.waiting} / ${totals.active}` : '—'}
          hint={
            queues.data
              ? `Outbox chưa đẩy: ${queues.data.outboxPending}`
              : undefined
          }
          icon={<IconStack2 size={22} />}
        />
        <StatTile
          label="Job thất bại"
          value={totals?.failed ?? '—'}
          hint={totals ? `${totals.completed} job đã hoàn tất` : undefined}
        />
      </SimpleGrid>
      {queues.isError && (
        <ErrorState error={queues.error} onRetry={queues.refetch} />
      )}
      <QueueTable />
      <RevenueCard />
    </Stack>
  );
}

function QueueTable() {
  const queues = useQuery({
    queryKey: ['queues'],
    queryFn: fetchQueueStats,
    refetchInterval: 5_000,
  });
  if (queues.isPending) return <LoadingState />;
  if (queues.isError) return null;
  return (
    <Card withBorder p={0}>
      <Text fw={600} p="md" pb={0}>
        Hàng đợi công việc nền (tự làm mới 5 giây)
      </Text>
      <Table.ScrollContainer minWidth={560}>
        <Table
          verticalSpacing="xs"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Hàng đợi</Table.Th>
              <Table.Th ta="right">Đang chờ</Table.Th>
              <Table.Th ta="right">Hẹn giờ</Table.Th>
              <Table.Th ta="right">Đang chạy</Table.Th>
              <Table.Th ta="right">Hoàn tất</Table.Th>
              <Table.Th ta="right">Thất bại</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {queues.data.queues.map((q) => (
              <Table.Tr key={q.name}>
                <Table.Td>{QUEUE_LABEL[q.name] ?? q.name}</Table.Td>
                <Table.Td ta="right">{q.waiting}</Table.Td>
                <Table.Td ta="right">{q.delayed}</Table.Td>
                <Table.Td ta="right">{q.active}</Table.Td>
                <Table.Td ta="right">{q.completed}</Table.Td>
                <Table.Td ta="right" fw={q.failed > 0 ? 700 : undefined}>
                  {q.failed}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

function RevenueCard() {
  const queryClient = useQueryClient();
  const reports = useQuery({
    queryKey: ['revenue'],
    queryFn: fetchRevenueReports,
  });
  const trigger = useMutation({
    mutationFn: () => triggerRevenueReport(),
    onSuccess: () => {
      notifySuccess(
        'Đã đưa job báo cáo vào hàng đợi — worker sẽ chạy trong giây lát',
      );
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ['revenue'] }),
        3000,
      );
    },
    onError: (e) => notifyError(e),
  });
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Báo cáo doanh thu hằng đêm</Text>
        <Button
          size="xs"
          variant="light"
          loading={trigger.isPending}
          onClick={() => trigger.mutate()}
        >
          Chạy báo cáo hôm nay
        </Button>
      </Group>
      {reports.isPending && <LoadingState />}
      {reports.isError && (
        <ErrorState error={reports.error} onRetry={reports.refetch} />
      )}
      {reports.data?.length === 0 && (
        <EmptyState
          title="Chưa có báo cáo"
          description="Job chạy lúc 23:00 mỗi ngày."
        />
      )}
      {reports.data && reports.data.length > 0 && (
        <Table.ScrollContainer minWidth={420}>
          <Table style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Ngày</Table.Th>
                <Table.Th ta="right">Đơn hợp lệ</Table.Th>
                <Table.Th ta="right">Đơn huỷ</Table.Th>
                <Table.Th ta="right">Doanh thu</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {reports.data.map((r) => (
                <Table.Tr key={r.date}>
                  <Table.Td>{r.date}</Table.Td>
                  <Table.Td ta="right">{r.orderCount}</Table.Td>
                  <Table.Td ta="right">{r.cancelledCount}</Table.Td>
                  <Table.Td ta="right">{formatVnd(r.revenue)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

/** Hàng đợi + dead letter: xem lý do thất bại, chạy lại (F05, F07.2). */
export function QueuesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const failed = useQuery({
    queryKey: ['failed-jobs', page],
    queryFn: () => fetchFailedJobs(page),
    placeholderData: keepPreviousData,
  });
  const retry = useMutation({
    mutationFn: retryFailedJob,
    onSuccess: () => {
      notifySuccess('Đã đưa job chạy lại');
      queryClient.invalidateQueries({ queryKey: ['failed-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['queues'] });
    },
    onError: (e) => notifyError(e),
  });

  return (
    <Stack>
      <Title order={2}>Hàng đợi công việc nền</Title>
      <QueueTable />
      <Card withBorder p={0}>
        <Text fw={600} p="md" pb={0}>
          Job đã hết lượt thử (dead letter)
        </Text>
        {failed.isPending && <LoadingState />}
        {failed.isError && (
          <ErrorState error={failed.error} onRetry={failed.refetch} />
        )}
        {failed.data?.items.length === 0 && (
          <EmptyState title="Không có job thất bại" />
        )}
        {failed.data && failed.data.items.length > 0 && (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Hàng đợi / job</Table.Th>
                  <Table.Th>Lý do</Table.Th>
                  <Table.Th>Số lần thử</Table.Th>
                  <Table.Th>Thất bại lúc</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {failed.data.items.map((j) => (
                  <Table.Tr key={j.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {QUEUE_LABEL[j.queue] ?? j.queue}
                      </Text>
                      <Code>{j.jobName}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={j.failedReason} multiline w={320}>
                        <Text size="sm" lineClamp={2} maw={320}>
                          {j.failedReason}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>{j.attemptsMade}</Table.Td>
                    <Table.Td>{formatDateTime(j.failedAt)}</Table.Td>
                    <Table.Td>
                      {j.retriedAt ? (
                        <Text size="xs" c="dimmed">
                          Đã chạy lại {formatDateTime(j.retriedAt)}
                        </Text>
                      ) : (
                        <Button
                          size="xs"
                          leftSection={<IconRefresh size={14} />}
                          loading={retry.isPending && retry.variables === j.id}
                          onClick={() => retry.mutate(j.id)}
                        >
                          Chạy lại
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
      {failed.data && (
        <Pager
          page={page}
          totalPages={failed.data.totalPages}
          onChange={setPage}
        />
      )}
    </Stack>
  );
}

/** Sức khoẻ hệ thống (F07.1) + chỉ số cache + đường dẫn tài liệu API (F07.3). */
export function SystemPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5_000,
  });
  const cache = useQuery({
    queryKey: ['cache-metrics'],
    queryFn: fetchCacheMetrics,
    refetchInterval: 5_000,
  });

  return (
    <Stack>
      <Title order={2}>Sức khoẻ hệ thống</Title>
      {health.isError && (
        <ErrorState error={health.error} onRetry={health.refetch} />
      )}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatTile
          label="Tổng thể"
          value={
            health.data ? <StatusPill ok={health.data.status === 'ok'} /> : '—'
          }
          hint="Tự kiểm tra mỗi 5 giây"
        />
        {Object.entries(health.data?.details ?? {}).map(([key, c]) => (
          <StatTile
            key={key}
            label={
              key === 'database'
                ? 'PostgreSQL'
                : key === 'redis'
                  ? 'Redis'
                  : key
            }
            value={
              <StatusPill
                ok={c.status === 'up'}
                okLabel="Kết nối tốt"
                badLabel="Mất kết nối"
              />
            }
            hint={c.message}
          />
        ))}
      </SimpleGrid>
      <Card withBorder>
        <Text fw={600} mb="xs">
          Bộ nhớ đệm (Redis)
        </Text>
        {cache.data ? (
          <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }}>
            <StatTile
              label="Tỉ lệ trúng"
              value={`${(cache.data.hitRatio * 100).toFixed(1)}%`}
            />
            <StatTile label="Trúng" value={cache.data.hits} />
            <StatTile label="Trượt" value={cache.data.misses} />
            <StatTile
              label="Chặn dò khoá"
              value={cache.data.nullHits}
              hint="giá trị rỗng"
            />
            <StatTile
              label="Chờ khoá nạp"
              value={cache.data.lockWaits}
              hint="chống dồn dập"
            />
            <StatTile
              label="Lỗi Redis"
              value={cache.data.errors}
              hint="đọc thẳng DB"
            />
          </SimpleGrid>
        ) : (
          <LoadingState />
        )}
        {cache.data && (
          <Text size="xs" c="dimmed" mt="xs">
            Đếm từ {formatDateTime(cache.data.since)} (mỗi instance API đếm
            riêng)
          </Text>
        )}
      </Card>
      <Text size="sm">
        Tài liệu API:{' '}
        <Anchor href="/api/docs" target="_blank">
          /api/docs
        </Anchor>
      </Text>
    </Stack>
  );
}

const ROLE_OPTIONS = (Object.keys(ROLE_LABEL) as Role[]).map((r) => ({
  value: r,
  label: ROLE_LABEL[r],
}));

/** Quản lý người dùng: đổi vai trò, khoá / mở khoá (F06.4). */
export function UsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ['users', page, role],
    queryFn: () => fetchUsers({ page, role: role ?? undefined }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      changeUserRole(id, role),
    onSuccess: () => {
      notifySuccess('Đã đổi vai trò');
      refresh();
    },
    onError: (e) => notifyError(e),
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      changeUserStatus(id, isActive),
    onSuccess: refresh,
    onError: (e) => notifyError(e),
  });

  return (
    <Stack>
      <Title order={2}>Người dùng</Title>
      <Select
        placeholder="Mọi vai trò"
        clearable
        data={ROLE_OPTIONS}
        value={role}
        onChange={(v) => {
          setRole(v);
          setPage(1);
        }}
        maw={240}
      />
      {users.isPending && <LoadingState />}
      {users.isError && (
        <ErrorState error={users.error} onRetry={users.refetch} />
      )}
      {users.data && (
        <Card withBorder p={0}>
          <Table.ScrollContainer minWidth={680}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Họ tên</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Vai trò</Table.Th>
                  <Table.Th>Hoạt động</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {users.data.items.map((u) => (
                  <Table.Tr key={u.id}>
                    <Table.Td>{u.fullName}</Table.Td>
                    <Table.Td>{u.email}</Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        data={ROLE_OPTIONS}
                        value={u.role}
                        disabled={u.id === me?.id}
                        onChange={(v) =>
                          v &&
                          v !== u.role &&
                          changeRole.mutate({ id: u.id, role: v as Role })
                        }
                        w={170}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        checked={u.isActive}
                        disabled={u.id === me?.id}
                        label={u.isActive ? 'Hoạt động' : 'Đã khoá'}
                        onChange={(e) =>
                          changeStatus.mutate({
                            id: u.id,
                            isActive: e.currentTarget.checked,
                          })
                        }
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {users.data && (
        <Pager
          page={page}
          totalPages={users.data.totalPages}
          onChange={setPage}
        />
      )}
    </Stack>
  );
}
