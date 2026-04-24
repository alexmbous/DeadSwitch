import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { BundlesModule } from '../bundles/bundles.module';

@Module({
  imports: [BundlesModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
