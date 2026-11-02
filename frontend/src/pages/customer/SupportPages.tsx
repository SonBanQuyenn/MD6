import {
  Alert,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import {
  createTicket,
  fetchMyOrders,
  fetchMyTickets,
  fetchTicket,
  sendTicketMessage,
} from '../../api/endpoints';
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
import { formatDateTime } from '../../lib/format';
import { notifyError, notifySuccess } from '../../lib/notify';

/** Khách: danh sách yêu cầu hỗ trợ + tạo yêu cầu mới. */
export function SupportPage() {
  const [page, setPage] = useState(1);
  const [opened, { open, close }] = useDisclosure();
  const tickets = useQuery({
    queryKey: ['my-tickets', page],
    queryFn: () => fetchMyTickets(page),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Hỗ trợ khách hàng</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Gửi yêu cầu
        </Button>
      </Group>
      <NewTicketModal opened={opened} onClose={close} />
      {tickets.isPending && <LoadingState />}
      {tickets.isError && (
        <ErrorState error={tickets.error} onRetry={tickets.refetch} />
      )}
      {tickets.data?.items.length === 0 && (
        <EmptyState
          title="Bạn chưa có yêu cầu hỗ trợ nào"
          description="Có thắc mắc về đơn hàng? Gửi yêu cầu, đội CSKH sẽ phản hồi sớm."
        />
      )}
      <Stack gap="sm">
        {tickets.data?.items.map((t) => (
          <Card key={t.id} withBorder component={Link} to={`/support/${t.id}`}>
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text fw={600}>{t.subject}</Text>
                <Text size="xs" c="dimmed">
                  {formatDateTime(t.createdAt)}
                  {t.order ? ` · Đơn ${t.order.code}` : ''}
                </Text>
              </div>
              <TicketStatusBadge status={t.status} />
            </Group>
          </Card>
        ))}
      </Stack>
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

function NewTicketModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ['my-orders', 1, ''],
    queryFn: () => fetchMyOrders({ page: 1 }),
    enabled: opened,
  });
  const form = useForm({
    initialValues: { subject: '', message: '', orderId: '' },
    validate: {
      subject: (v: string) =>
        v.trim().length >= 5 ? null : 'Chủ đề tối thiểu 5 ký tự',
      message: (v: string) =>
        v.trim().length >= 10 ? null : 'Nội dung tối thiểu 10 ký tự',
    },
  });
  const mutation = useMutation({
    mutationFn: (values: typeof form.values) =>
      createTicket({
        subject: values.subject.trim(),
        message: values.message.trim(),
        orderId: values.orderId || undefined,
      }),
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['my-tickets'] });
      notifySuccess('Đã gửi yêu cầu hỗ trợ');
      form.reset();
      onClose();
      navigate(`/support/${ticket.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Gửi yêu cầu hỗ trợ"
      size="lg"
    >
      <form onSubmit={form.onSubmit((v) => mutation.mutate(v))}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput label="Chủ đề" {...form.getInputProps('subject')} />
          <Select
            label="Đơn hàng liên quan (không bắt buộc)"
            clearable
            data={
              orders.data?.items.map((o) => ({
                value: o.id,
                label: `${o.code} — ${o.statusLabel}`,
              })) ?? []
            }
            {...form.getInputProps('orderId')}
          />
          <Textarea
            label="Nội dung"
            autosize
            minRows={4}
            {...form.getInputProps('message')}
          />
          <Button type="submit" loading={mutation.isPending}>
            Gửi
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

/** Khách: chi tiết một yêu cầu (không thấy hội thoại nội bộ với AI). */
export function CustomerTicketPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => fetchTicket(id),
    refetchInterval: 15_000, // nhận phản hồi của CSKH mà không cần tải lại
  });
  const reply = useMutation({
    mutationFn: (content: string) => sendTicketMessage(id, content),
    onSuccess: (data) => queryClient.setQueryData(['ticket', id], data),
    onError: (e) => notifyError(e),
  });

  if (ticket.isPending) return <LoadingState />;
  if (ticket.isError)
    return <ErrorState error={ticket.error} onRetry={ticket.refetch} />;
  const t = ticket.data;
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={3}>{t.subject}</Title>
          <Text size="sm" c="dimmed">
            {t.order ? `Đơn ${t.order.code} · ` : ''}
            {t.categoryLabel ?? 'Đang phân loại…'}
          </Text>
        </div>
        <TicketStatusBadge status={t.status} />
      </Group>
      <TicketThread messages={t.messages ?? []} />
      <ReplyBox
        loading={reply.isPending}
        disabled={t.status === 'CLOSED'}
        onSend={(c) => reply.mutateAsync(c)}
      />
    </Stack>
  );
}
