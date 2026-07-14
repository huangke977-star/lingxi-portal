import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  BACKGROUND_MAX_FILE_SIZE_BYTES,
  BACKGROUND_MAX_FILES_PER_UPLOAD,
  BackgroundsService,
} from './backgrounds.service';
import { BackgroundImageResponse, UploadedBackgroundFile } from './backgrounds.types';

@Controller('backgrounds')
export class BackgroundsController {
  constructor(private readonly backgroundsService: BackgroundsService) {}

  @Get('active')
  async getActive(): Promise<{ background: BackgroundImageResponse | null }> {
    return { background: await this.backgroundsService.getActive() };
  }

  @Get('files/:storedName')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getFile(@Param('storedName') storedName: string): Promise<StreamableFile> {
    const file = await this.backgroundsService.getFile(storedName);
    return new StreamableFile(createReadStream(file.filePath), { type: file.mimeType });
  }

  @Get()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  list(): Promise<BackgroundImageResponse[]> {
    return this.backgroundsService.list();
  }

  @Post()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @UseInterceptors(
    FilesInterceptor('files', BACKGROUND_MAX_FILES_PER_UPLOAD, {
      limits: { fileSize: BACKGROUND_MAX_FILE_SIZE_BYTES, files: BACKGROUND_MAX_FILES_PER_UPLOAD },
    }),
  )
  upload(
    @UploadedFiles() files: UploadedBackgroundFile[] | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BackgroundImageResponse[]> {
    return this.backgroundsService.uploadMany(files, user.id);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  activate(@Param('id', ParseIntPipe) id: number): Promise<BackgroundImageResponse> {
    return this.backgroundsService.activate(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async delete(@Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.backgroundsService.delete(id);
    return { success: true };
  }
}
