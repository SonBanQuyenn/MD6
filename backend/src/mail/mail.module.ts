import { Module } from '@nestjs/common';
import { EmailLogsRepository } from './email-logs.repository';
import { EmailService } from './email.service';
import { MailerService } from './mailer.service';

@Module({
  providers: [MailerService, EmailLogsRepository, EmailService],
  exports: [EmailService, MailerService],
})
export class MailModule {}
