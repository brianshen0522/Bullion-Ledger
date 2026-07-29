import { beforeEach, describe, expect, it, vi } from 'vitest';

const aws = vi.hoisted(() => ({
  clients: [] as Array<{ endpoint: string; send: ReturnType<typeof vi.fn> }>,
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  class S3Client {
    readonly endpoint: string;
    readonly send = vi.fn().mockResolvedValue({});

    constructor(options: { endpoint: string }) {
      this.endpoint = options.endpoint;
      aws.clients.push(this);
    }
  }
  return {
    S3Client,
    HeadBucketCommand: Command,
    HeadObjectCommand: Command,
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    CreateBucketCommand: Command,
    DeleteObjectCommand: Command,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: aws.getSignedUrl }));

import { StorageService } from '../src/storage/storage.service';

describe('StorageService endpoint separation', () => {
  beforeEach(() => {
    aws.clients.length = 0;
    aws.getSignedUrl.mockReset().mockResolvedValue('https://objects.example.test/signed');
  });

  it('uses the internal client for bucket operations and the public client for signed URLs', async () => {
    const values: Record<string, string> = {
      MINIO_INTERNAL_ENDPOINT: 'http://minio:9000',
      MINIO_PUBLIC_ENDPOINT: 'https://objects.example.test',
      MINIO_ACCESS_KEY: 'service-user',
      MINIO_SECRET_KEY: 'service-secret',
      MINIO_SIGNED_URL_TTL_SEC: '99999',
    };
    const config = { get: vi.fn((key: string) => values[key]) };
    const service = new StorageService(config as never);

    await service.onModuleInit();
    const result = await service.issueReadUrl('intakes/user/draft/file', {
      filename: '發票.pdf',
      mime: 'application/pdf',
      download: true,
    });

    expect(aws.clients.map((client) => client.endpoint)).toEqual([
      'http://minio:9000',
      'https://objects.example.test',
    ]);
    expect(aws.clients[0]!.send).toHaveBeenCalled();
    expect(aws.getSignedUrl).toHaveBeenCalledWith(
      aws.clients[1],
      expect.objectContaining({
        input: expect.objectContaining({
          ResponseCacheControl: 'private, no-store',
          ResponseContentDisposition: expect.stringContaining("filename*=UTF-8''"),
        }),
      }),
      { expiresIn: 300 },
    );
    expect(result.expiresInSeconds).toBe(300);
  });
});
