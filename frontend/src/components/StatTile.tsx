import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';

/** Ô số liệu: con số dùng màu chữ thường (không tô màu theo "series"), nhãn phụ màu nhạt. */
export function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Text
            component="div"
            fz={28}
            fw={700}
            lh={1.2}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {value}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Stack>
        {icon && <Text c="dimmed">{icon}</Text>}
      </Group>
    </Card>
  );
}

/** Trạng thái tốt/xấu: LUÔN có icon + chữ, không chỉ dựa vào màu (người mù màu vẫn đọc được). */
export function StatusPill({
  ok,
  okLabel = 'Hoạt động',
  badLabel = 'Sự cố',
}: {
  ok: boolean;
  okLabel?: string;
  badLabel?: string;
}) {
  return (
    <Badge
      color={ok ? 'green' : 'red'}
      variant="light"
      leftSection={
        ok ? <IconCircleCheck size={12} /> : <IconAlertTriangle size={12} />
      }
    >
      {ok ? okLabel : badLabel}
    </Badge>
  );
}
