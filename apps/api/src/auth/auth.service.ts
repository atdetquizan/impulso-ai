import { BadGatewayException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Session } from '@supabase/supabase-js';
import type { AuthUser, MagicLinkResponse } from '@impulso/contracts';
import { SupabaseService } from '../supabase/supabase.service.js';
import { AuthEmailService } from './auth-email.service.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.guard.js';
import { MagicLinkRateLimitService } from './magic-link-rate-limit.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly frontendUrl: string;
  private readonly secureCookies: boolean;
  private readonly magicLinkCooldownSeconds: number;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: AuthEmailService,
    private readonly rateLimit: MagicLinkRateLimitService,
    config: ConfigService,
  ) {
    this.logger.log(`AuthService initialized with frontend URL: ${config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200'}`);
    this.frontendUrl = config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    this.secureCookies = config.get<string>('NODE_ENV') === 'production';
    this.magicLinkCooldownSeconds = this.positiveInteger(
      config.get<string | number>('AUTH_MAGIC_LINK_COOLDOWN_SECONDS'),
      60,
    );
  }

  async sendMagicLink(email: string): Promise<MagicLinkResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const reservation = await this.rateLimit.claim(normalizedEmail, this.magicLinkCooldownSeconds);
    if (!reservation.allowed) {
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'AUTH_RATE_LIMIT',
        message: `Ya solicitaste un enlace recientemente. Espera ${reservation.retryAfterSeconds} segundos antes de solicitar uno nuevo.`,
        retryAfterSeconds: reservation.retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    try {
      const { data, error } = await this.supabase.admin.auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
        options: { redirectTo: `${this.frontendUrl}/auth/callback` },
      });
      const actionLink = data?.properties?.action_link;

      if (error || !actionLink) {
        this.logger.error(`Supabase no pudo generar el Magic Link: ${error?.message ?? 'respuesta sin action_link'}`);
        throw new BadGatewayException({
          code: 'AUTH_MAGIC_LINK_FAILED',
          message: 'No pudimos generar el enlace de acceso. Inténtalo nuevamente en unos instantes.',
        });
      }

      await this.email.sendMagicLink(normalizedEmail, actionLink);
      return {
        sent: true,
        retryAfterSeconds: this.magicLinkCooldownSeconds,
      };
    } catch (error) {
      await this.rateLimit.release(reservation.claim);
      throw error;
    }
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

  private positiveInteger(value: string | number | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
