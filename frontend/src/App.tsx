import { Container, Stack, Text, Title } from '@mantine/core';
import { SystemStatus } from './components/SystemStatus';

export default function App() {
  return (
    <Container size="sm" py={64} px="md">
      <Stack align="center" gap="lg">
        <Title order={1} c="orange">
          ShopFast
        </Title>
        <Text c="dimmed" ta="center">
          Sàn thương mại điện tử — đang trong giai đoạn khởi tạo dự án.
        </Text>
        <SystemStatus />
      </Stack>
    </Container>
  );
}
