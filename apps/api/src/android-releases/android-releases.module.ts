import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AndroidReleasesController } from './android-releases.controller';
import { AndroidReleasesService } from './android-releases.service';

@Module({
  controllers: [AndroidReleasesController],
  providers: [PrismaService, AndroidReleasesService],
})
export class AndroidReleasesModule {}
