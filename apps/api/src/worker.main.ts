import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { WorkerModule } from './worker.module.js';

/**
 * BullMQ worker entry point (PRD §20.1 `worker` service). Runs no HTTP server;
 * its only job is to drain the market-price queue.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  // Buffered logs stay invisible until flushed; without this a failing worker
  // looks like a silent one.
  app.flushLogs();
  app.enableShutdownHooks();
  Logger.log('Market price worker started', 'Worker');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      Logger.log(`Received ${signal}, shutting down`, 'Worker');
      // Let in-flight jobs finish so a deploy cannot strand a half-written
      // snapshot; BullMQ re-queues anything still unacknowledged.
      void app.close().then(() => process.exit(0));
    });
  }
}

bootstrap().catch((error) => {
  console.error('Fatal worker bootstrap error', error);
  process.exit(1);
});
