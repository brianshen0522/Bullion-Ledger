import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  PayloadTooLargeException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser, type AuthContext } from '../common/decorators/current-user.decorator.js';
import { requireIdempotencyKey } from '../purchases/purchase-idempotency.js';
import {
  AttachmentReadUrlQueryDto,
  ReviewAttachmentDto,
  UploadAttachmentQueryDto,
  UploadAttachmentVariantQueryDto,
} from './dto/attachment.dto.js';
import { AttachmentsService } from './attachments.service.js';

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('purchase-intakes/:intakeId/attachments/upload')
  async upload(
    @Param('intakeId') intakeId: string,
    @Query() metadata: UploadAttachmentQueryDto,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-encoding') contentEncoding: string | undefined,
    @Headers('x-filename') filename: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    if (!contentType) throw new UnsupportedMediaTypeException('Content-Type is required');
    if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
      throw new UnsupportedMediaTypeException('Compressed request bodies are not accepted');
    }
    if (!filename) throw new BadRequestException('X-Filename is required');
    const bytes = await readBoundedRawBody(req, this.attachments.maxRawUploadBytes(contentType));
    return this.attachments.upload({
      intakeId,
      userId: auth.userId,
      filename,
      declaredMime: contentType,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      bytes,
      metadata,
      auditContext: auditContext(auth, req),
    });
  }

  @Post('assets/:assetId/attachments/upload')
  async uploadForAsset(
    @Param('assetId') assetId: string,
    @Query() metadata: UploadAttachmentQueryDto,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-encoding') contentEncoding: string | undefined,
    @Headers('x-filename') filename: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    if (!contentType) throw new UnsupportedMediaTypeException('Content-Type is required');
    if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
      throw new UnsupportedMediaTypeException('Compressed request bodies are not accepted');
    }
    if (!filename) throw new BadRequestException('X-Filename is required');
    const bytes = await readBoundedRawBody(req, this.attachments.maxRawUploadBytes(contentType));
    return this.attachments.uploadForAsset({
      assetId,
      userId: auth.userId,
      filename,
      declaredMime: contentType,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      bytes,
      metadata,
      auditContext: auditContext(auth, req),
    });
  }

  @Get('assets/:assetId/attachments')
  listAssetAttachments(
    @Param('assetId') assetId: string,
    @CurrentUser() user: AuthContext | null,
  ) {
    return this.attachments.listForAsset(requireUser(user).userId, assetId);
  }

  @Post('attachments/:id/variants/upload')
  async uploadVariant(
    @Param('id') id: string,
    @Query() query: UploadAttachmentVariantQueryDto,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-encoding') contentEncoding: string | undefined,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    if (!contentType) throw new UnsupportedMediaTypeException('Content-Type is required');
    if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
      throw new UnsupportedMediaTypeException('Compressed request bodies are not accepted');
    }
    const bytes = await readBoundedRawBody(req, this.attachments.maxRawUploadBytes(contentType));
    return this.attachments.uploadVariant(
      auth.userId,
      id,
      query.kind,
      contentType,
      bytes,
      auditContext(auth, req),
    );
  }

  @Patch('attachments/:id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewAttachmentDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    return this.attachments.review(auth.userId, id, dto, auditContext(auth, req));
  }

  @Delete('attachments/:id')
  softDelete(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    return this.attachments.softDelete(auth.userId, id, auditContext(auth, req));
  }

  @Get('attachments/:id/url')
  readUrl(
    @Param('id') id: string,
    @Query() query: AttachmentReadUrlQueryDto,
    @CurrentUser() user: AuthContext | null,
  ) {
    return this.attachments.issueReadUrl(
      requireUser(user).userId,
      id,
      query.variant,
      query.revision,
    );
  }
}

export async function readBoundedRawBody(req: Request, maximumBytes: number): Promise<Uint8Array> {
  const lengthHeader = req.headers['content-length'];
  let declaredLength: number | null = null;
  if (typeof lengthHeader === 'string') {
    declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new BadRequestException('Content-Length is invalid');
    }
    if (declaredLength > maximumBytes) {
      throw new PayloadTooLargeException('Attachment exceeds the configured upload limit');
    }
  }

  const captured = (req as Request & { rawBody?: Buffer }).rawBody;
  if (Buffer.isBuffer(captured)) {
    if (captured.byteLength > maximumBytes) {
      throw new PayloadTooLargeException('Attachment exceeds the configured upload limit');
    }
    if (declaredLength !== null && captured.byteLength !== declaredLength) {
      throw new BadRequestException('Attachment body does not match Content-Length');
    }
    return new Uint8Array(captured);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > maximumBytes) {
      throw new PayloadTooLargeException('Attachment exceeds the configured upload limit');
    }
    chunks.push(buffer);
  }
  if (declaredLength !== null && total !== declaredLength) {
    throw new BadRequestException('Attachment body does not match Content-Length');
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

function requireUser(user: AuthContext | null): AuthContext {
  if (!user) throw new UnauthorizedException('Session required');
  return user;
}

function auditContext(user: AuthContext, req: Request) {
  return {
    userId: user.userId,
    sessionId: user.sessionId,
    ip: req.ip || undefined,
    userAgent: req.headers['user-agent'],
  };
}
