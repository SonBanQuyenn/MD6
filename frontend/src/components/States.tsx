import {
  Alert,
  Button,
  Center,
  Loader,
  Pagination,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { IconAlertTriangle, IconInbox } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { errorMessage } from '../api/client';

/** Trạng thái dùng chung cho mọi trang: đang tải / lỗi / rỗng — giao diện thống nhất. */
export function LoadingState({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <Center py="xl">
      <Stack align="center" gap="xs">
        <Loader />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <Alert
      color="red"
      icon={<IconAlertTriangle size={18} />}
      title="Không tải được dữ liệu"
      my="md"
    >
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{errorMessage(error)}</Text>
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry}>
            Thử lại
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Center py="xl">
      <Stack align="center" gap="xs" maw={360}>
        <ThemeIcon size={48} radius="xl" variant="light" color="gray">
          <IconInbox size={26} />
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        {description && (
          <Text size="sm" c="dimmed" ta="center">
            {description}
          </Text>
        )}
        {action}
      </Stack>
    </Center>
  );
}

export function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <Center mt="lg">
      <Pagination value={page} total={totalPages} onChange={onChange} />
    </Center>
  );
}
