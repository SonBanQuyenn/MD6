import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ALL_QUEUES, QueueName } from '../queues';
import { JobsAdminService } from './jobs-admin.service';

class FailedJobsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ALL_QUEUES, {
    message: `queue phải là một trong: ${ALL_QUEUES.join(', ')}`,
  })
  queue?: QueueName;
}

class TriggerReportDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date phải có dạng YYYY-MM-DD' })
  date?: string;
}

/** Theo dõi & vận hành hàng đợi — chỉ ADMIN (F05, F07.2). */
@Controller('admin')
@Roles(Role.ADMIN)
export class JobsAdminController {
  constructor(private readonly jobsAdmin: JobsAdminService) {}

  /** GET /api/admin/queues — số job chờ / đang chạy / xong / lỗi / hẹn giờ. */
  @Get('queues')
  stats() {
    return this.jobsAdmin.stats();
  }

  /** GET /api/admin/jobs/failed — dead letter: job đã hết lượt thử, kèm lý do. */
  @Get('jobs/failed')
  listFailed(@Query() query: FailedJobsQueryDto) {
    return this.jobsAdmin.listFailed(query);
  }

  @Post('jobs/failed/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobsAdmin.retryFailed(id);
  }

  @Get('reports/daily-revenue')
  reports() {
    return this.jobsAdmin.listReports();
  }

  /** POST /api/admin/reports/daily-revenue — chạy báo cáo ngay (mặc định hôm nay). */
  @Post('reports/daily-revenue')
  @HttpCode(HttpStatus.ACCEPTED)
  triggerReport(@Body() dto: TriggerReportDto) {
    return this.jobsAdmin.triggerDailyReport(dto.date);
  }
}
