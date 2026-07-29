import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as exempt from session authentication. Reserved for health
 * checks, first-run initialization, and login. Public registration is never
 * exposed (PRD §4.2).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
