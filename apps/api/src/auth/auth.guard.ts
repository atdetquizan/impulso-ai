import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from './public.decorator.js';
import { AuthTokenService } from './auth-token.service.js';

export interface AuthenticatedRequest extends Request {
  user: { id: string; email?: string };
}

export const ACCESS_COOKIE = 'impulso_access_token';
export const REFRESH_COOKIE = 'impulso_refresh_token';

function readCookie(request: Request, name: string) {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: AuthTokenService) {}

  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? readCookie(request, ACCESS_COOKIE);
    if (!token) throw new UnauthorizedException('Missing session');
    const payload = this.tokens.verifyAccessToken(token);
    request.user = { id: payload.sub, email: payload.email };
    return true;
  }
}
