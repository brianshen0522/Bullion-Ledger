import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { registerBackupBodyParser } from '../src/backup/backup.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

@Controller()
class EchoController {
  @Post('backup/inspect')
  @HttpCode(200)
  inspect(@Body() body: { file: string }) {
    return { bytes: body.file.length };
  }

  @Post('backup/restore')
  @HttpCode(200)
  restore(@Body() body: { file: string }) {
    return { bytes: body.file.length };
  }

  @Post('elsewhere')
  @HttpCode(200)
  elsewhere(@Body() body: { file: string }) {
    return { bytes: body.file.length };
  }
}

describe('backup request body limit', () => {
  const file = 'x'.repeat(300 * 1024);
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    registerBackupBodyParser(app, 'api', 1);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/api/backup/inspect', '/api/backup/restore'])(
    'accepts an archive at %s',
    async (url) => {
      const response = await request(app.getHttpServer()).post(url).send({ file });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ bytes: file.length });
    },
  );

  it('still enforces the route limit on backup routes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/backup/restore')
      .send({ file: 'x'.repeat(2 * 1024 * 1024) });

    expect(response.status).toBe(413);
  });

  it('leaves ordinary JSON parsing in place on other routes', async () => {
    const response = await request(app.getHttpServer()).post('/api/elsewhere').send({ file: 'x' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bytes: 1 });
  });

  it('leaves every other route on the small default', async () => {
    const response = await request(app.getHttpServer()).post('/api/elsewhere').send({ file });

    expect(response.status).toBe(413);
  });
});
