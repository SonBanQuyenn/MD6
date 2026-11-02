import {
  Badge,
  Button,
  Card,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { useState } from 'react';
import type { TicketMessage } from '../api/types';
import {
  formatDateTime,
  TICKET_STATUS_COLOR,
  TICKET_STATUS_LABEL,
} from '../lib/format';
import type { TicketStatus } from '../api/types';

const AUTHOR: Record<
  TicketMessage['authorType'],
  { label: string; color: string }
> = {
  CUSTOMER: { label: 'Khách hàng', color: 'blue' },
  AGENT: { label: 'Nhân viên CSKH', color: 'orange' },
  AI: { label: 'Trợ lý AI', color: 'grape' },
  SYSTEM: { label: 'Hệ thống', color: 'gray' },
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge color={TICKET_STATUS_COLOR[status]} variant="light">
      {TICKET_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Luồng tin nhắn của ticket. `showInternal`: nhân viên thấy cả hội thoại nội bộ với AI. */
export function TicketThread({
  messages,
  showInternal = false,
}: {
  messages: TicketMessage[];
  showInternal?: boolean;
}) {
  const visible = showInternal ? messages : messages.filter((m) => !m.internal);
  return (
    <Stack gap="sm">
      {visible.map((m) => {
        const author = AUTHOR[m.authorType];
        return (
          <Paper
            key={m.id}
            withBorder
            p="sm"
            radius="md"
            bg={m.internal ? 'var(--mantine-color-default-hover)' : undefined}
          >
            <Group justify="space-between" mb={4} wrap="nowrap">
              <Group gap={6}>
                <Badge size="xs" color={author.color} variant="light">
                  {author.label}
                </Badge>
                {m.internal && (
                  <Badge size="xs" color="gray" variant="outline">
                    Nội bộ — khách không thấy
                  </Badge>
                )}
                {m.metadata?.mock && (
                  <Badge size="xs" color="red" variant="filled">
                    MOCK AI
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {formatDateTime(m.createdAt)}
              </Text>
            </Group>
            <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
              {m.content}
            </Text>
          </Paper>
        );
      })}
    </Stack>
  );
}

export function ReplyBox({
  onSend,
  loading,
  disabled,
  placeholder = 'Nhập tin nhắn…',
}: {
  onSend: (content: string) => Promise<unknown>;
  loading: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [content, setContent] = useState('');
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Textarea
          autosize
          minRows={2}
          maxRows={6}
          placeholder={placeholder}
          value={content}
          disabled={disabled}
          onChange={(e) => setContent(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button
            loading={loading}
            disabled={disabled || content.trim().length === 0}
            onClick={async () => {
              await onSend(content.trim());
              setContent('');
            }}
          >
            Gửi
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
