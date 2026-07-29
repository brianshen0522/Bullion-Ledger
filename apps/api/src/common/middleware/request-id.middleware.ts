import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

type RequestWithId = Request & { requestId?: string };

/** Attaches a stable per-request id for log correlation; echoes inbound header. */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
