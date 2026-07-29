import { Module } from '@nestjs/common';

import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';
import { AttachmentsDtoModule } from './dto/attachments-dto.module.js';

@Module({
  imports: [AttachmentsDtoModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
