import { execSync } from 'child_process';
import './setup-env';

/** Chạy 1 lần trước toàn bộ integration test: áp dụng migration lên database test. */
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}
