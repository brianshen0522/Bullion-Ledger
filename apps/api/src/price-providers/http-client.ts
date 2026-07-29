import { Injectable, Logger } from '@nestjs/common';

/**
 * Bounded JSON fetcher for third-party market APIs.
 *
 * Outbound calls to somebody else's service are the one place this app cannot
 * control latency or payload size, so both are capped: a hung upstream must not
 * pin a worker, and a malformed or hostile response must not be buffered
 * without limit. Retries are deliberately few — a scheduled job runs again
 * shortly, so hammering a struggling upstream buys nothing.
 */

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  attempts?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 400;

export class HttpFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpFetchError';
  }
}

@Injectable()
export class PriceHttpClient {
  private readonly logger = new Logger('PriceHttp');

  async getJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
    const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.attemptGetJson<T>(url, options);
      } catch (error) {
        lastError = error;
        // A 4xx is a request problem; repeating it verbatim cannot help.
        if (error instanceof HttpFetchError && isClientError(error.status)) throw error;
        if (attempt < attempts) {
          await delay(RETRY_BASE_DELAY_MS * attempt);
          this.logger.warn(`Retrying ${redact(url)} (attempt ${attempt + 1}/${attempts})`);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new HttpFetchError(String(lastError));
  }

  private async attemptGetJson<T>(url: string, options: FetchOptions): Promise<T> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'application/json', ...options.headers },
      });

      if (!response.ok) {
        throw new HttpFetchError(`${redact(url)} responded ${response.status}`, response.status);
      }

      const text = await readBounded(response, maxBytes);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new HttpFetchError(`${redact(url)} returned a non-JSON body`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpFetchError(`${redact(url)} timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Streams the body, aborting once the cap is passed. `Content-Length` alone is
 * not trusted because it is supplied by the same party as the body.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new HttpFetchError(`response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function isClientError(status?: number): boolean {
  // 429 is excluded: it is explicitly a "try again later" signal.
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

/** Keeps any query-string credential out of logs and error messages. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'the upstream request';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
