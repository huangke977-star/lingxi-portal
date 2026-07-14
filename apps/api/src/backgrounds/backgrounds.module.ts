import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../prisma/prisma.service';
import { BackgroundsController } from './backgrounds.controller';
import { BackgroundsService } from './backgrounds.service';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [BackgroundsController],
  providers: [PrismaService, BackgroundsService],
})
export class BackgroundsModule {}
