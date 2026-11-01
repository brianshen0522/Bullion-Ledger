import { Request, Response, NextFunction } from 'express';

/**
 * Every API response describes a private ledger, so no browser or shared cache
 * may keep one. A handler can still set its own value; backup export does.
 */
export function responseHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
