import { Module } from '@nestjs/common';
import { JobsAdminController } from './jobs-admin.controller';
import { JobsAdminService } from './jobs-admin.service';

/** Phần quản trị hàng đợi chạy trong tiến trình API (dùng JobsModule.forRoot('producer')). */
@Module({
  controllers: [JobsAdminController],
  providers: [JobsAdminService],
})
export class JobsAdminModule {}
