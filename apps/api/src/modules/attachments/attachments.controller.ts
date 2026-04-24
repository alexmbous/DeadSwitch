import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { memoryStorage } = require('multer') as { memoryStorage: () => unknown };
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AttachmentsService, UploadedAttachmentFile } from './attachments.service';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

@UseGuards(JwtAuthGuard)
@Controller('bundles/:bundleId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  list(@CurrentUser() user: { userId: string }, @Param('bundleId') bundleId: string) {
    return this.attachments.list(user.userId, bundleId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: { userId: string },
    @Param('bundleId') bundleId: string,
    @UploadedFile() file: UploadedAttachmentFile,
  ) {
    return this.attachments.upload(user.userId, bundleId, file);
  }

  @Delete(':attachmentId')
  remove(
    @CurrentUser() user: { userId: string },
    @Param('bundleId') bundleId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachments.remove(user.userId, bundleId, attachmentId);
  }
}
