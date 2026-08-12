import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Session } from '@supabase/supabase-js';
import type { AuthUser } from '@impulso/contracts';
import { SupabaseService } from '../supabase/supabase.service.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.guard.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly frontendUrl: string;
  private readonly secureCookies: boolean;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
  ) {
    this.frontendUrl = config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    this.secureCookies = config.get<string>('NODE_ENV') === 'production';
  }

  async sendMagicLink(email: string) {
    const { error } = await this.supabase.auth.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${this.frontendUrl}/auth/callback` },
    });
    if (error) {
      const retryAfterSeconds = this.retryAfterSeconds(error.message);
      if (error.status === HttpStatus.TOO_MANY_REQUESTS || error.code === 'over_email_send_rate_limit' || retryAfterSeconds !== null) {
        const waitMessage = retryAfterSeconds === null
          ? 'Espera unos segundos antes de solicitar un nuevo enlace de acceso.'
          : `Por seguridad, espera ${retryAfterSeconds} segundos antes de solicitar un nuevo enlace de acceso.`;
        throw new HttpException({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'AUTH_RATE_LIMIT',
          message: `Ya solicitaste un enlace recientemente. ${waitMessage}`,
          retryAfterSeconds,
        }, HttpStatus.TOO_MANY_REQUESTS);
      }

      this.logger.warn(`Supabase rechazó el envío del magic link: ${error.message}`);
      throw new BadRequestException({
        code: 'AUTH_MAGIC_LINK_FAILED',
        message: 'No pudimos enviar el enlace de acceso. Verifica el correo e inténtalo nuevamente.',
      });
    }
    return { sent: true };
  }

  async createSession(accessToken: string, refreshToken: string, response: Response) {
    const { data, error } = await this.supabase.admin.auth.getUser(accessToken);
    if (error || !data.user) throw new UnauthorizedException('Invalid Supabase session');

    const { data: refreshed, error: refreshError } = await this.supabase.auth.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (refreshError || !refreshed.session) throw new UnauthorizedException('Invalid refresh token');

    this.writeCookies(response, refreshed.session);
    return { user: this.mapUser(refreshed.session.user) };
  }

  async refresh(refreshToken: string | undefined, response: Response) {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh session');
    const { data, error } = await this.supabase.auth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw new UnauthorizedException('Session expired');
    this.writeCookies(response, data.session);
    return { user: this.mapUser(data.session.user) };
  }

  clearSession(response: Response) {
    response.clearCookie(ACCESS_COOKIE, this.cookieOptions());
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { signedOut: true };
  }

  readRefreshCookie(cookieHeader: string | undefined) {
    if (!cookieHeader) return undefined;
    for (const pair of cookieHeader.split(';')) {
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      if (pair.slice(0, separator).trim() === REFRESH_COOKIE) {
        return decodeURIComponent(pair.slice(separator + 1).trim());
      }
    }
    return undefined;
  }

  private writeCookies(response: Response, session: Session) {
    response.cookie(ACCESS_COOKIE, session.access_token, {
      ...this.cookieOptions(),
      maxAge: Math.max(60, session.expires_in) * 1000,
    });
    response.cookie(REFRESH_COOKIE, session.refresh_token, {
      ...this.cookieOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private cookieOptions() {
    return { httpOnly: true, secure: this.secureCookies, sameSite: 'lax' as const, path: '/' };
  }

  private mapUser(user: { id: string; email?: string }): AuthUser {
    return { id: user.id, email: user.email ?? null };
  }

  private retryAfterSeconds(message: string) {
    const match = message.match(/after\s+(\d+)\s+seconds?/i);
    return match?.[1] ? Number(match[1]) : null;
  }
}
