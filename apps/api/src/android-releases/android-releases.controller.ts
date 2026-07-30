import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { createReadStream } from 'node:fs';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  ANDROID_RELEASE_MAX_FILE_SIZE_BYTES,
  UploadedAndroidPackage,
  createAndroidReleaseStorage,
} from './android-release.storage';
import { AndroidReleasesService } from './android-releases.service';
import { AndroidReleaseResponse } from './android-releases.types';
import { UploadAndroidReleaseDto } from './dto/android-release.dto';

@Controller('android-releases')
export class AndroidReleasesController {
  constructor(private readonly androidReleasesService: AndroidReleasesService) {}

  @Get('latest')
  async getLatest(): Promise<{ release: AndroidReleaseResponse | null }> {
    return { release: await this.androidReleasesService.getLatest() };
  }

  @Get('files/:storedName')
  async downloadRelease(
    @Param('storedName') storedName: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const release = await this.androidReleasesService.getFile(storedName);
    const fallbackName = release.originalName.replace(/[^A-Za-z0-9._-]/g, '_') || 'hlovet.apk';
    response.set({
      'Cache-Control': 'public, max-age=300',
      'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(release.originalName)}`,
      'Content-Length': String(release.sizeBytes),
      'Content-Security-Policy': 'sandbox',
      'Content-Type': release.mimeType,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(createReadStream(release.filePath));
  }

  @Get()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  list(): Promise<AndroidReleaseResponse[]> {
    return this.androidReleasesService.list();
  }

  @Post()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createAndroidReleaseStorage(),
      limits: { fileSize: ANDROID_RELEASE_MAX_FILE_SIZE_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedAndroidPackage | undefined,
    @Body() dto: UploadAndroidReleaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AndroidReleaseResponse> {
    return this.androidReleasesService.upload(file, dto, user.id);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  activate(@Param('id', ParseIntPipe) id: number): Promise<AndroidReleaseResponse> {
    return this.androidReleasesService.activate(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async delete(@Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.androidReleasesService.delete(id);
    return { success: true };
  }
}
