import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [PrismaService, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
