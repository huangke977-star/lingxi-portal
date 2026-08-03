import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { BackgroundsController } from './backgrounds.controller';
import { BackgroundsService } from './backgrounds.service';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [BackgroundsController],
  providers: [BackgroundsService],
})
export class BackgroundsModule {}
