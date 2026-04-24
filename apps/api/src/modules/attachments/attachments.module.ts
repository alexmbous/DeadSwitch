import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { AttachmentDownloadController } from './attachment-download.controller';
import { AttachmentDownloadService } from './attachment-download.service';
import { BundlesModule } from '../bundles/bundles.module';

@Module({
  imports: [BundlesModule],
  controllers: [AttachmentsController, AttachmentDownloadController],
  providers: [AttachmentsService, AttachmentDownloadService],
  exports: [AttachmentDownloadService],
})
export class AttachmentsModule {}
