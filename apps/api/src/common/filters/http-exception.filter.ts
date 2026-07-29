import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { ArgumentError } from '@bullion-ledger/shared';

/**
 * Maps domain and framework errors to a consistent JSON envelope and never
 * leaks stack traces or framework internals to the client. Sensitive error
 * details are logged server-side only.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request | undefined>();

    const mapped = this.map(exception);

    if (mapped.status >= 500) {
      this.logger.error(
        `${req?.method ?? ''} ${req?.url ?? ''} -> ${mapped.status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (mapped.status === 401 || mapped.status === 429) {
      // Do not log credentials; warn level only.
      this.logger.warn(`${req?.method ?? ''} ${req?.url ?? ''} -> ${mapped.status}`);
    }

    res.status(mapped.status).json({
      statusCode: mapped.status,
      error: mapped.error,
      message: mapped.message,
      ...(mapped.code ? { code: mapped.code } : {}),
      requestId: req?.headers?.['x-request-id'] ?? undefined,
    });
  }

  private map(exception: unknown): {
    status: number;
    error: string;
    message: string | string[];
    code?: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return { status, error: exception.name, message: response };
      }
      if (response && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        return {
          status,
          error: typeof r.error === 'string' ? r.error : exception.name,
          ...(typeof r.code === 'string' ? { code: r.code } : {}),
          message:
            typeof r.message === 'string'
              ? r.message
              : Array.isArray(r.message)
                ? (r.message as string[])
                : exception.message,
        };
      }
      return { status, error: exception.name, message: exception.message };
    }

    if (exception instanceof ArgumentError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'ArgumentError',
        message: exception.message,
      };
    }

    // body-parser rejects malformed or oversized bodies before any guard or
    // pipe runs, and its errors are plain Errors. Reporting them as 500 would
    // blame the server for a request the client got wrong.
    const bodyParserStatus = readBodyParserStatus(exception);
    if (bodyParserStatus !== null) {
      return {
        status: bodyParserStatus,
        error: bodyParserStatus === HttpStatus.PAYLOAD_TOO_LARGE ? 'PayloadTooLarge' : 'BadRequest',
        message:
          bodyParserStatus === HttpStatus.PAYLOAD_TOO_LARGE
            ? 'Request body is too large'
            : 'Request body could not be parsed',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'Internal server error',
    };
  }
}

/**
 * Recognizes an error raised by body-parser. Only the 4xx statuses it produces
 * are honoured, so an unrelated error carrying a `status` property cannot
 * choose its own response code.
 */
function readBodyParserStatus(exception: unknown): number | null {
  if (!(exception instanceof Error)) return null;
  const candidate = exception as Error & { status?: unknown; type?: unknown };
  if (typeof candidate.type !== 'string') return null;
  if (!candidate.type.startsWith('entity.') && !candidate.type.startsWith('request.')) return null;

  const status = candidate.status;
  if (typeof status !== 'number') return null;
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) return status;
  return status >= 400 && status < 500 ? HttpStatus.BAD_REQUEST : null;
}
