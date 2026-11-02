import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconRobot,
  IconShieldCheck,
} from '@tabler/icons-react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import {
  approveAction,
  askAssistant,
  fetchTicket,
  fetchTickets,
  rejectAction,
  sendTicketMessage,
  updateTicket,
} from '../../api/endpoints';
import type { AssistantAnswer, PendingAction, Ticket } from '../../api/types';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
} from '../../components/States';
import {
  ReplyBox,
  TicketStatusBadge,
  TicketThread,
} from '../../components/TicketThread';
import {
  CATEGORY_OPTIONS,
  formatDateTime,
  TICKET_STATUS_LABEL,
} from '../../lib/format';
import { notifyError, notifySuccess } from '../../lib/notify';

const STATUS_OPTIONS = Object.entries(TICKET_STATUS_LABEL).map(
  ([value, label]) => ({ value, label }),
);
const CLASSIFIED_BY: Record<string, string> = {
  AI: 'AI',
  FALLBACK: 'Từ khoá dự phòng',
  HUMAN: 'Nhân viên',
};

/** CSKH: danh sách ticket, lọc theo trạng thái / nhóm do AI phân loại. */
export function SupportDeskPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | null>('OPEN');
  const [category, setCategory] = useState<string | null>(null);
  const tickets = useQuery({
    queryKey: ['tickets', page, status, category],
    queryFn: () =>
      fetchTickets({
        page,
        status: status ?? undefined,
        category: category ?? undefined,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });

  return (
    <Stack>
      <Title order={2}>Ticket hỗ trợ</Title>
      <Group>
        <Select
          placeholder="Mọi trạng thái"
          clearable
          data={STATUS_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <Select
          placeholder="Mọi nhóm"
          clearable
          data={CATEGORY_OPTIONS}
          value={category}
          onChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        />
      </Group>
      {tickets.isPending && <LoadingState />}
      {tickets.isError && (
        <ErrorState error={tickets.error} onRetry={tickets.refetch} />
      )}
      {tickets.data?.items.length === 0 && (
        <EmptyState title="Không có ticket nào" />
      )}
      {tickets.data && tickets.data.items.length > 0 && (
        <Card withBorder p={0}>
          <Table.ScrollContainer minWidth={720}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Chủ đề</Table.Th>
                  <Table.Th>Khách hàng</Table.Th>
                  <Table.Th>Nhóm (phân loại)</Table.Th>
                  <Table.Th>Trạng thái</Table.Th>
                  <Table.Th>Tạo lúc</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tickets.data.items.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Text
                        component={Link}
                        to={`/staff/support/${t.id}`}
                        fw={600}
                      >
                        {t.subject}
                      </Text>
                    </Table.Td>
                    <Table.Td>{t.customer.fullName}</Table.Td>
                    <Table.Td>
                      {t.categoryLabel ? (
                        <Group gap={4}>
                          <Badge variant="light">{t.categoryLabel}</Badge>
                          <Text size="xs" c="dimmed">
                            {t.classifiedBy
                              ? CLASSIFIED_BY[t.classifiedBy]
                              : ''}
                          </Text>
                        </Group>
                      ) : (
                        <Text size="xs" c="dimmed">
                          Đang phân loại…
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <TicketStatusBadge status={t.status} />
                    </Table.Td>
                    <Table.Td>{formatDateTime(t.createdAt)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {tickets.data && (
        <Pager
          page={page}
          totalPages={tickets.data.totalPages}
          onChange={setPage}
        />
      )}
    </Stack>
  );
}

/** CSKH: xử lý 1 ticket — trả lời khách, hỏi trợ lý AI, duyệt thao tác AI đề xuất. */
export function StaffTicketPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => fetchTicket(id),
  });
  const setTicket = (data: Ticket) =>
    queryClient.setQueryData(['ticket', id], data);

  const reply = useMutation({
    mutationFn: (content: string) => sendTicketMessage(id, content),
    onSuccess: setTicket,
    onError: (e) => notifyError(e),
  });
  const update = useMutation({
    mutationFn: (body: { status?: string; category?: string }) =>
      updateTicket(id, body),
    onSuccess: (data) => {
      setTicket(data);
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => notifyError(e),
  });

  if (ticket.isPending) return <LoadingState />;
  if (ticket.isError)
    return <ErrorState error={ticket.error} onRetry={ticket.refetch} />;
  const t = ticket.data;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>{t.subject}</Title>
          <Text size="sm" c="dimmed">
            {t.customer.fullName} ({t.customer.email})
            {t.order && (
              <>
                {' · '}
                <Link to={`/orders/${t.order.id}`}>Đơn {t.order.code}</Link>
              </>
            )}
          </Text>
        </div>
        <Group>
          <Select
            label="Trạng thái"
            data={STATUS_OPTIONS}
            value={t.status}
            onChange={(v) => v && update.mutate({ status: v })}
            w={170}
          />
          <Select
            label={`Nhóm${t.classifiedBy ? ` (${CLASSIFIED_BY[t.classifiedBy]})` : ''}`}
            data={CATEGORY_OPTIONS}
            value={t.category}
            placeholder="Chưa phân loại"
            onChange={(v) => v && update.mutate({ category: v })}
            w={210}
          />
        </Group>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack>
            <TicketThread messages={t.messages ?? []} showInternal />
            <ReplyBox
              placeholder="Trả lời khách hàng…"
              loading={reply.isPending}
              disabled={t.status === 'CLOSED'}
              onSend={(c) => reply.mutateAsync(c)}
            />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack>
            <AssistantPanel ticket={t} />
            <PendingActionsCard
              ticketId={t.id}
              actions={t.pendingActions ?? []}
            />
            <ToolLogCard ticket={t} />
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function AssistantPanel({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => askAssistant(ticket.id, question.trim()),
    onSuccess: (data) => {
      setAnswer(data);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
    },
    // 503 = AI tạm thời không khả dụng → nhân viên xử lý thủ công
    onError: (e) => setError(errorMessage(e)),
  });

  const suggestions = [
    ticket.order
      ? `Kiểm tra trạng thái đơn ${ticket.order.code}`
      : 'Kiểm tra đơn SF-…',
    'Sản phẩm SKU … còn hàng không?',
    ticket.order ? `Khách muốn huỷ đơn ${ticket.order.code}` : null,
  ].filter(Boolean) as string[];

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <IconRobot size={20} />
          <Text fw={600}>Trợ lý AI</Text>
        </Group>
        <Group gap={6}>
          {suggestions.map((s) => (
            <Badge
              key={s}
              variant="outline"
              style={{ cursor: 'pointer', textTransform: 'none' }}
              onClick={() => setQuestion(s)}
            >
              {s}
            </Badge>
          ))}
        </Group>
        <Textarea
          autosize
          minRows={2}
          placeholder="Hỏi về đơn hàng, tồn kho… (AI tra cứu dữ liệu thật)"
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
        />
        <Button
          loading={ask.isPending}
          disabled={question.trim().length < 2}
          onClick={() => ask.mutate()}
        >
          Hỏi trợ lý
        </Button>
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}
        {answer && (
          <Stack gap="xs">
            {answer.mock && (
              <Alert color="red" variant="filled" p="xs">
                ⚠️ MOCK AI — không phải phản hồi AI thật (AI_PROVIDER=mock)
              </Alert>
            )}
            {answer.guardrail.blocked && (
              <Alert color="orange" icon={<IconShieldCheck size={16} />} p="xs">
                Guardrail đã chặn một câu trả lời chưa được kiểm chứng:{' '}
                {answer.guardrail.reason}
              </Alert>
            )}
            <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
              {answer.answer}
            </Text>
            <Text size="xs" c="dimmed">
              {answer.provider} · {answer.model} · {answer.toolCalls.length} lần
              tra cứu
            </Text>
            {answer.toolCalls.length > 0 && (
              <Accordion variant="contained">
                {answer.toolCalls.map((c, idx) => (
                  <Accordion.Item key={idx} value={String(idx)}>
                    <Accordion.Control>
                      <Group gap={6}>
                        <Badge size="xs" color={c.success ? 'green' : 'red'}>
                          {c.name}
                        </Badge>
                        <Text size="xs">{c.durationMs} ms</Text>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Code block>{JSON.stringify(c.output, null, 2)}</Code>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

const ACTION_STATUS: Record<
  PendingAction['status'],
  { label: string; color: string }
> = {
  PENDING: { label: 'Chờ duyệt', color: 'orange' },
  EXECUTED: { label: 'Đã thực hiện', color: 'green' },
  REJECTED: { label: 'Đã từ chối', color: 'gray' },
  FAILED: { label: 'Thất bại', color: 'red' },
};

/** Thao tác GHI do AI đề xuất — chỉ thực hiện khi nhân viên bấm Duyệt (F01.4). */
function PendingActionsCard({
  ticketId,
  actions,
}: {
  ticketId: string;
  actions: PendingAction[];
}) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
  const approve = useMutation({
    mutationFn: approveAction,
    onSuccess: () => {
      notifySuccess('Đã duyệt và thực hiện');
      refresh();
    },
    onError: (e) => {
      notifyError(e);
      refresh();
    },
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectAction(id),
    onSuccess: () => {
      notifySuccess('Đã từ chối đề xuất');
      refresh();
    },
    onError: (e) => notifyError(e),
  });

  if (actions.length === 0) return null;
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Đề xuất của AI (cần người duyệt)
      </Text>
      <Stack gap="xs">
        {actions.map((a) => (
          <Card key={a.id} withBorder p="xs">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" fw={500}>
                  Huỷ đơn {a.payload.orderCode}
                </Text>
                <Text size="xs" c="dimmed">
                  {a.reason}
                </Text>
              </div>
              <Badge color={ACTION_STATUS[a.status].color}>
                {ACTION_STATUS[a.status].label}
              </Badge>
            </Group>
            {a.status === 'PENDING' && (
              <Group mt="xs" gap="xs">
                <Button
                  size="xs"
                  color="red"
                  loading={approve.isPending}
                  onClick={() => approve.mutate(a.id)}
                >
                  Duyệt — huỷ đơn
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  loading={reject.isPending}
                  onClick={() => reject.mutate(a.id)}
                >
                  Từ chối
                </Button>
              </Group>
            )}
          </Card>
        ))}
      </Stack>
    </Card>
  );
}

function ToolLogCard({ ticket }: { ticket: Ticket }) {
  const calls = ticket.toolCalls ?? [];
  if (calls.length === 0) return null;
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Nhật ký tra cứu của AI ({calls.length})
      </Text>
      <Stack gap={4}>
        {calls.slice(-10).map((c) => (
          <Group key={c.id} justify="space-between" wrap="nowrap">
            <Badge
              size="xs"
              variant="light"
              color={c.success ? 'green' : 'red'}
            >
              {c.toolName}
            </Badge>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {JSON.stringify(c.input)} · {formatDateTime(c.createdAt)}
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
