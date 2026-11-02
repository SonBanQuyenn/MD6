import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  PasswordInput,
  PinInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { requestVerificationCode, resetPassword } from '../../api/endpoints';
import { homeFor, useAuth } from '../../auth/AuthContext';
import { notifySuccess } from '../../lib/notify';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRule = (v: string) =>
  v.length < 8
    ? 'Mật khẩu phải có ít nhất 8 ký tự'
    : !/[A-Za-z]/.test(v) || !/\d/.test(v)
      ? 'Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số'
      : null;

function AuthCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Center py="xl">
      <Card withBorder padding="xl" w="100%" maw={420}>
        <Title order={2} mb="md">
          {title}
        </Title>
        {children}
      </Card>
    </Center>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (v: string) => (EMAIL.test(v) ? null : 'Email không hợp lệ'),
      password: (v: string) => (v ? null : 'Vui lòng nhập mật khẩu'),
    },
  });

  const submit = form.onSubmit(async (values) => {
    setError(null);
    setLoading(true);
    try {
      const user = await login(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? homeFor(user.role), { replace: true });
    } catch (e) {
      // 401 sai mật khẩu, 429 vượt hạn mức / tài khoản tạm khoá (F03) — hiển thị nguyên thông điệp
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  });

  return (
    <AuthCard title="Đăng nhập">
      <form onSubmit={submit}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput
            label="Email"
            autoComplete="email"
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label="Mật khẩu"
            autoComplete="current-password"
            {...form.getInputProps('password')}
          />
          <Button type="submit" loading={loading}>
            Đăng nhập
          </Button>
          <Text size="sm">
            <Anchor component={Link} to="/forgot-password">
              Quên mật khẩu?
            </Anchor>{' '}
            · Chưa có tài khoản?{' '}
            <Anchor component={Link} to="/register">
              Đăng ký
            </Anchor>
          </Text>
          <DemoAccounts />
        </Stack>
      </form>
    </AuthCard>
  );
}

/** Tài khoản mẫu từ script seed — CHỈ hiển thị khi chạy dev (npm run dev). */
function DemoAccounts() {
  if (!import.meta.env.DEV) return null;
  return (
    <Alert color="gray" title="Tài khoản mẫu (chỉ môi trường dev)">
      <Table fz="xs">
        <Table.Tbody>
          {['customer', 'support', 'warehouse', 'admin'].map((r) => (
            <Table.Tr key={r}>
              <Table.Td>{r}@shopfast.local</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" mt={4}>
        Mật khẩu: giá trị SEED_PASSWORD trong file .env
      </Text>
    </Alert>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm({
    initialValues: { fullName: '', email: '', password: '', confirm: '' },
    validate: {
      fullName: (v: string) =>
        v.trim().length >= 2 ? null : 'Họ tên phải có ít nhất 2 ký tự',
      email: (v: string) => (EMAIL.test(v) ? null : 'Email không hợp lệ'),
      password: passwordRule,
      confirm: (v: string, values: { password: string }) =>
        v === values.password ? null : 'Mật khẩu nhập lại không khớp',
    },
  });

  const submit = form.onSubmit(async ({ fullName, email, password }) => {
    setError(null);
    setLoading(true);
    try {
      await register({ fullName, email, password });
      notifySuccess('Đăng ký thành công, chào mừng bạn đến ShopFast!');
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  });

  return (
    <AuthCard title="Tạo tài khoản">
      <form onSubmit={submit}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput label="Họ tên" {...form.getInputProps('fullName')} />
          <TextInput
            label="Email"
            autoComplete="email"
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label="Mật khẩu"
            description="Ít nhất 8 ký tự, có chữ và số"
            autoComplete="new-password"
            {...form.getInputProps('password')}
          />
          <PasswordInput
            label="Nhập lại mật khẩu"
            {...form.getInputProps('confirm')}
          />
          <Button type="submit" loading={loading}>
            Đăng ký
          </Button>
          <Text size="sm">
            Đã có tài khoản?{' '}
            <Anchor component={Link} to="/login">
              Đăng nhập
            </Anchor>
          </Text>
        </Stack>
      </form>
    </AuthCard>
  );
}

/** Quên mật khẩu: gửi mã 6 số qua email (giới hạn 3 lần / 15 phút — F03) → đặt mật khẩu mới. */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm({
    initialValues: { email: '', code: '', newPassword: '' },
    validate: (values) =>
      step === 'email'
        ? { email: EMAIL.test(values.email) ? null : 'Email không hợp lệ' }
        : {
            code: /^\d{6}$/.test(values.code) ? null : 'Mã gồm 6 chữ số',
            newPassword: passwordRule(values.newPassword),
          },
  });

  const submit = form.onSubmit(async (values) => {
    setError(null);
    setLoading(true);
    try {
      if (step === 'email') {
        const res = await requestVerificationCode(
          values.email,
          'RESET_PASSWORD',
        );
        setInfo(res.message);
        setStep('reset');
      } else {
        const res = await resetPassword(values);
        notifySuccess(res.message);
        navigate('/login');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  });

  return (
    <AuthCard title="Quên mật khẩu">
      <form onSubmit={submit}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          {info && <Alert color="blue">{info}</Alert>}
          <TextInput
            label="Email"
            disabled={step === 'reset'}
            {...form.getInputProps('email')}
          />
          {step === 'reset' && (
            <>
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Mã xác thực (6 số trong email)
                </Text>
                <PinInput
                  length={6}
                  type="number"
                  oneTimeCode
                  {...form.getInputProps('code')}
                />
                {form.errors.code && (
                  <Text size="xs" c="red">
                    {form.errors.code}
                  </Text>
                )}
              </Stack>
              <PasswordInput
                label="Mật khẩu mới"
                {...form.getInputProps('newPassword')}
              />
            </>
          )}
          <Button type="submit" loading={loading}>
            {step === 'email' ? 'Gửi mã xác thực' : 'Đặt lại mật khẩu'}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
