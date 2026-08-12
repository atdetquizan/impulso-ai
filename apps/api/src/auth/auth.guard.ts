import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { IS_PUBLIC } from './public.decorator.js';
import { SupabaseService } from '../supabase/supabase.service.js';

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
    if (pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secureCookies: boolean;

  constructor(private readonly reflector: Reflector, private readonly supabase: SupabaseService, config: ConfigService) {
    this.secureCookies = config.get<string>('NODE_ENV') === 'production';
  }

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? readCookie(request, ACCESS_COOKIE);
    if (token) {
      const { data, error } = await this.supabase.admin.auth.getUser(token);
      if (!error && data.user) {
        request.user = { id: data.user.id, email: data.user.email };
        return true;
      }
    }

    const refreshToken = readCookie(request, REFRESH_COOKIE);
    if (!refreshToken) throw new UnauthorizedException('Missing session');
    const { data, error } = await this.supabase.auth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw new UnauthorizedException('Session expired');
    const options = { httpOnly: true, secure: this.secureCookies, sameSite: 'lax' as const, path: '/' };
    response.cookie(ACCESS_COOKIE, data.session.access_token, {
      ...options,
      maxAge: Math.max(60, data.session.expires_in) * 1000,
    });
    response.cookie(REFRESH_COOKIE, data.session.refresh_token, {
      ...options,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    request.user = { id: data.session.user.id, email: data.session.user.email };
    return true;
  }
}
