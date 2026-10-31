import { Module } from '@nestjs/common';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, RefreshTokensRepository],
  exports: [UsersRepository, RefreshTokensRepository],
})
export class UsersModule {}
