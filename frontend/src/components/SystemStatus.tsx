import { Alert, Badge, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api/health';

const LABELS: Record<string, string> = {
  database: 'PostgreSQL',
  redis: 'Redis',
};

/** Thẻ hiển thị trạng thái backend, tự làm mới mỗi 10 giây. */
export function SystemStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  return (
    <Card withBorder padding="lg" w="100%" maw={420}>
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Trạng thái hệ thống</Text>
        {data && (
          <Badge color={data.status === 'ok' ? 'green' : 'red'}>
            {data.status === 'ok' ? 'Hoạt động' : 'Có sự cố'}
          </Badge>
        )}
      </Group>

      {isPending && <Loader size="sm" />}

      {isError && (
        <Alert color="red" title="Không kết nối được backend">
          Kiểm tra backend đã chạy ở cổng 3000 chưa.
        </Alert>
      )}

      {data && (
        <Stack gap="xs">
          {Object.entries(data.details).map(([key, component]) => (
            <Group key={key} justify="space-between">
              <Text size="sm">{LABELS[key] ?? key}</Text>
              <Badge
                variant="light"
                color={component.status === 'up' ? 'green' : 'red'}
              >
                {component.status}
              </Badge>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}
