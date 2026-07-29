import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConnection, type Socket } from 'node:net';
import { connect as createTlsConnection, type TLSSocket } from 'node:tls';

const PROBE_TIMEOUT_MS = 2_000;
const MAX_RESPONSE_BYTES = 8_192;

export interface RedisEndpoint {
  host: string;
  port: number;
  tls: boolean;
  username?: string;
  password?: string;
  database?: number;
}

/**
 * Minimal Redis boundary for infrastructure readiness. BullMQ can consume the
 * same REDIS_URL when background jobs are introduced; Phase 1 does not keep a
 * second connection pool alive merely to issue health probes.
 */
@Injectable()
export class RedisHealthService {
  private readonly redisUrl: string;

  constructor(config: ConfigService) {
    this.redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
  }

  async checkReady(): Promise<boolean> {
    let endpoint: RedisEndpoint;
    try {
      endpoint = parseRedisUrl(this.redisUrl);
    } catch {
      return false;
    }

    return probeRedis(endpoint);
  }
}

export function parseRedisUrl(value: string): RedisEndpoint {
  const url = new URL(value);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  if (!url.hostname) throw new Error('REDIS_URL must include a host');

  const port = url.port === '' ? (url.protocol === 'rediss:' ? 6380 : 6379) : Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('REDIS_URL contains an invalid port');
  }

  const databaseText = url.pathname.replace(/^\//, '');
  const database = databaseText === '' ? undefined : Number(databaseText);
  if (database !== undefined && (!Number.isSafeInteger(database) || database < 0)) {
    throw new Error('REDIS_URL contains an invalid database');
  }

  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port,
    tls: url.protocol === 'rediss:',
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database,
  };
}

function probeRedis(endpoint: RedisEndpoint): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket | TLSSocket;
    let response = '';
    let settled = false;

    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    const onConnected = (): void => {
      socket.write(buildProbe(endpoint));
    };

    if (endpoint.tls) {
      socket = createTlsConnection({ host: endpoint.host, port: endpoint.port });
      socket.once('secureConnect', onConnected);
    } else {
      socket = createConnection({ host: endpoint.host, port: endpoint.port });
      socket.once('connect', onConnected);
    }

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
      if (response.length > MAX_RESPONSE_BYTES || response.includes('-ERR')) {
        finish(false);
        return;
      }
      if (response.includes('+PONG\r\n')) finish(true);
    });
    socket.on('close', () => finish(response.includes('+PONG\r\n')));
  });
}

function buildProbe(endpoint: RedisEndpoint): string {
  const commands: string[][] = [];
  if (endpoint.password) {
    commands.push(
      endpoint.username
        ? ['AUTH', endpoint.username, endpoint.password]
        : ['AUTH', endpoint.password],
    );
  }
  if (endpoint.database !== undefined && endpoint.database !== 0) {
    commands.push(['SELECT', String(endpoint.database)]);
  }
  commands.push(['PING']);
  return commands.map(encodeRedisCommand).join('');
}

function encodeRedisCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join('')}`;
}
