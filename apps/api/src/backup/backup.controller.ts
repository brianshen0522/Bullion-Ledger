import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { BackupService } from './backup.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';
import { BackupExportDto, BackupRestoreDto } from './dto/backup.dto.js';
import type { AuditContext } from '../audit/audit.service.js';

/** Restoring replaces the account, so the archive itself is size-capped. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function auditContext(user: AuthContext | null, req: Request): AuditContext {
  return {
    userId: user?.userId ?? null,
    sessionId: user?.sessionId ?? null,
    ip: req.ip || null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/**
 * Backup and restore (PRD §24).
 *
 * Both directions require re-authentication. Export because the file contains
 * the password hash and every passkey; restore because it silently replaces the
 * owner's credentials with the ones inside the archive.
 */
@Controller('backup')
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly auth: AuthService,
  ) {}

  @Post('export')
  @Header('Content-Type', 'application/octet-stream')
  async export(
    @Body() dto: BackupExportDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const auth = requireUser(user);
    await this.auth.requireReauthentication(auth.userId, dto.currentPassword, auth.sessionId);

    const file = await this.backup.export(dto.passphrase, auditContext(user, req));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="bullion-ledger-${stamp}.blbak"`);
    res.setHeader('Content-Length', String(file.byteLength));
    // The archive is already encrypted; caching it anywhere would be worse.
    res.setHeader('Cache-Control', 'no-store');
    res.end(file);
  }

  /** Reads an archive and reports its contents without changing anything. */
  @Post('inspect')
  @HttpCode(200)
  async inspect(@Body() dto: BackupRestoreDto, @CurrentUser() user: AuthContext | null) {
    requireUser(user);
    return this.backup.inspect(decodeArchive(dto.file), dto.passphrase);
  }

  @Post('restore')
  @HttpCode(200)
  async restore(
    @Body() dto: BackupRestoreDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    await this.auth.requireReauthentication(auth.userId, dto.currentPassword, auth.sessionId);

    const archive = decodeArchive(dto.file);
    const context = auditContext(user, req);

    // PRD §24.3: a safety copy of what is about to be replaced. Produced with
    // the same passphrase so the operator has exactly one secret to remember.
    const safetyCopy = await this.backup.export(dto.passphrase, context);

    const summary = await this.backup.restore(archive, dto.passphrase, context);
    await this.backup.revokeAllSessions();

    return {
      ...summary,
      // Returned rather than written to disk: the server has no durable place
      // to put it that the restore itself would not have overwritten.
      safetyBackupBase64: safetyCopy.toString('base64'),
      message: '還原完成。所有工作階段已登出，請使用備份檔中的帳號密碼重新登入。',
    };
  }
}

function requireUser(user: AuthContext | null): AuthContext {
  if (!user) throw new UnauthorizedException('Session required');
  return user;
}

function decodeArchive(base64: string): Buffer {
  const file = Buffer.from(base64, 'base64');
  if (file.byteLength === 0) throw new BadRequestException('backup file is empty');
  if (file.byteLength > MAX_UPLOAD_BYTES) {
    throw new BadRequestException('backup file exceeds the maximum restorable size');
  }
  return file;
}
