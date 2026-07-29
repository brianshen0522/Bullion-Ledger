import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

interface StorageConfig {
  internalEndpoint: string;
  publicEndpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
  signedUrlTtlSec: number;
}

const DEFAULT_TTL = 5 * 60; // 5 min, per PRD §14.3 "短效 signed URL"

/**
 * S3-compatible private bucket boundary backed by MinIO. The bucket is
 * created on boot if missing and is never set to public-read. Signed URLs
 * are short-lived and issued only to authenticated callers (controller layer).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('Storage');
  private readonly config: StorageConfig;
  private internalClient: S3Client | null = null;
  private publicClient: S3Client | null = null;
  private bucketReady = false;

  constructor(configService: ConfigService) {
    const legacyEndpoint = configService.get<string>('MINIO_ENDPOINT') ?? 'http://localhost:9000';
    this.config = {
      internalEndpoint: configService.get<string>('MINIO_INTERNAL_ENDPOINT') ?? legacyEndpoint,
      publicEndpoint: configService.get<string>('MINIO_PUBLIC_ENDPOINT') ?? legacyEndpoint,
      region: configService.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKey: configService.get<string>('MINIO_ACCESS_KEY') ?? '',
      secretKey: configService.get<string>('MINIO_SECRET_KEY') ?? '',
      bucket: configService.get<string>('MINIO_BUCKET') ?? 'bullion-ledger',
      forcePathStyle: true,
      signedUrlTtlSec: parseNumber(
        configService.get<string>('MINIO_SIGNED_URL_TTL_SEC'),
        DEFAULT_TTL,
      ),
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.accessKey || !this.config.secretKey) {
      this.logger.warn('MinIO credentials missing; storage will run in no-op mode');
      return;
    }
    try {
      const clientOptions = {
        region: this.config.region,
        credentials: {
          accessKeyId: this.config.accessKey,
          secretAccessKey: this.config.secretKey,
        },
        forcePathStyle: this.config.forcePathStyle,
      };
      this.internalClient = new S3Client({
        ...clientOptions,
        endpoint: this.config.internalEndpoint,
      });
      this.publicClient = new S3Client({
        ...clientOptions,
        endpoint: this.config.publicEndpoint,
      });
      await this.ensureBucket();
      this.bucketReady = true;
      this.logger.log(`MinIO ready (bucket=${this.config.bucket})`);
    } catch (e) {
      this.logger.warn(`MinIO unavailable: ${(e as Error).message}; storage degraded`);
    }
  }

  isReady(): boolean {
    return this.bucketReady;
  }

  /** Performs a current dependency probe for readiness checks. */
  async checkReady(): Promise<boolean> {
    if (!this.internalClient) return false;
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: this.config.bucket }), {
        abortSignal: AbortSignal.timeout(2_000),
      });
      this.bucketReady = true;
      return true;
    } catch {
      this.bucketReady = false;
      return false;
    }
  }

  /** Returns a one-time upload URL plus the server-side storage key to persist. */
  async issueUploadUrl(opts: {
    mime: string;
    filename: string;
    ownerType: string;
    ownerId: string;
  }): Promise<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }> {
    if (!this.publicClient) throw new Error('Storage unavailable');
    const storageKey = `${opts.ownerType}/${opts.ownerId}/${randomUUID()}/${sanitize(opts.filename)}`;
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      ContentType: opts.mime,
    });
    const uploadUrl = await getSignedUrl(this.publicClient, command, {
      expiresIn: this.config.signedUrlTtlSec,
    });
    return { storageKey, uploadUrl, expiresInSeconds: this.config.signedUrlTtlSec };
  }

  async issueReadUrl(
    storageKey: string,
    opts: { filename?: string; mime?: string; download?: boolean } = {},
  ): Promise<{ url: string; expiresInSeconds: number }> {
    if (!this.publicClient) throw new Error('Storage unavailable');
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      ResponseCacheControl: 'private, no-store',
      ...(opts.mime ? { ResponseContentType: opts.mime } : {}),
      ...(opts.filename
        ? {
            ResponseContentDisposition: contentDisposition(
              opts.filename,
              opts.download === true ? 'attachment' : 'inline',
            ),
          }
        : {}),
    });
    const url = await getSignedUrl(this.publicClient, command, {
      expiresIn: this.config.signedUrlTtlSec,
    });
    return { url, expiresInSeconds: this.config.signedUrlTtlSec };
  }

  /**
   * Same-origin upload endpoints use this method after validating the request
   * body. It deliberately accepts a server-generated key only; controllers
   * must never expose arbitrary object-key writes to clients.
   */
  async putObject(opts: {
    storageKey: string;
    mime: string;
    body: Uint8Array;
    cacheControl?: string;
  }): Promise<{ etag: string | null }> {
    if (!this.internalClient) throw new Error('Storage unavailable');
    const result = await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: opts.storageKey,
        Body: opts.body,
        ContentLength: opts.body.byteLength,
        ContentType: opts.mime,
        CacheControl: opts.cacheControl ?? 'private, no-store',
      }),
    );
    return { etag: result.ETag ?? null };
  }

  /**
   * Reads an object's bytes server-side. Used only by backup export, which
   * needs the content itself rather than a URL a browser could follow.
   */
  async getObjectBytes(storageKey: string): Promise<Uint8Array> {
    if (!this.internalClient) throw new Error('Storage unavailable');
    const result = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: storageKey }),
    );
    const body = result.Body;
    if (!body) return new Uint8Array();
    return new Uint8Array(await body.transformToByteArray());
  }

  async headObject(storageKey: string): Promise<{
    sizeBytes: number;
    mime: string | null;
    etag: string | null;
  }> {
    if (!this.internalClient) throw new Error('Storage unavailable');
    const result = await this.internalClient.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: storageKey }),
    );
    return {
      sizeBytes: result.ContentLength ?? 0,
      mime: result.ContentType ?? null,
      etag: result.ETag ?? null,
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    if (!this.internalClient) throw new Error('Storage unavailable');
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: storageKey }),
    );
  }

  private async ensureBucket(): Promise<void> {
    if (!this.internalClient) return;
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      this.logger.log(`Creating private bucket ${this.config.bucket}`);
      await this.internalClient.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 30 && n <= 900 ? n : fallback;
}

function sanitize(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function contentDisposition(filename: string, mode: 'inline' | 'attachment'): string {
  const clean =
    Array.from(filename, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === '\\' || character === '/' ? '_' : character;
    })
      .join('')
      .slice(0, 240) || 'attachment';
  const fallback = clean.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
