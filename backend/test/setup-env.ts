/**
 * Biến môi trường cho integration test — chạy TRƯỚC khi AppModule đọc cấu hình.
 * Dùng database RIÊNG (shopfast_test) và Redis DB số 1 để test không xoá dữ liệu dev.
 * ConfigModule không ghi đè biến đã có sẵn trong process.env, nên giá trị ở đây được ưu tiên.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://shopfast:shopfast_dev_password@localhost:5432/shopfast_test?schema=public';
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.JWT_ACCESS_SECRET =
  process.env.TEST_JWT_ACCESS_SECRET ??
  'integration-test-only-secret-not-used-anywhere-else';
// bcrypt 4 vòng: test nhanh hơn ~50 lần; production vẫn dùng 12.
process.env.BCRYPT_ROUNDS = '4';
