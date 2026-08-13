import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuthUser, MagicLinkResponse } from '@impulso/contracts';
import { SupabaseService } from '../supabase/supabase.service.js';
import { AuthEmailService } from './auth-email.service.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.guard.js';
import { MagicLinkRateLimitService } from './magic-link-rate-limit.service.js';
import { AuthTokenService } from './auth-token.service.js';

interface AppUserRow { id: string; email: string }

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly frontendUrl: string;
  private readonly secureCookies: boolean;
  private readonly magicLinkCooldownSeconds: number;
  private readonly magicLinkTtlMinutes: number;
  private readonly refreshTokenTtlDays: number;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: AuthEmailService,
    private readonly rateLimit: MagicLinkRateLimitService,
    private readonly tokens: AuthTokenService,
    config: ConfigService,
  ) {
    this.frontendUrl = (config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200').replace(/\/$/, '');
    this.secureCookies = config.get<string>('NODE_ENV') === 'production';
    this.magicLinkCooldownSeconds = this.positiveInteger(config.get('AUTH_MAGIC_LINK_COOLDOWN_SECONDS'), 60);
    this.magicLinkTtlMinutes = this.positiveInteger(config.get('AUTH_MAGIC_LINK_TTL_MINUTES'), 15);
    this.refreshTokenTtlDays = this.positiveInteger(config.get('AUTH_REFRESH_TOKEN_TTL_DAYS'), 30);
    this.logger.log(`Autenticación propia activa: ${this.frontendUrl}/api/auth/verify`);
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
      const rawToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + this.magicLinkTtlMinutes * 60_000).toISOString();
      const { error } = await this.supabase.admin.rpc('issue_app_magic_link', {
        p_email: normalizedEmail,
        p_token_hash: this.hash(rawToken),
        p_expires_at: expiresAt,
      });
      if (error) throw new Error(`No se pudo registrar el enlace: ${error.message}`);

      // La URL pertenece a la aplicación y Vercel enruta /api hacia NestJS.
      const actionLink = `${this.frontendUrl}/api/auth/verify?token=${encodeURIComponent(rawToken)}`;
      await this.email.sendMagicLink(normalizedEmail, actionLink);
      return { sent: true, retryAfterSeconds: this.magicLinkCooldownSeconds };
    } catch (error) {
      this.logger.error(`No se pudo crear el enlace de acceso propio: ${this.errorMessage(error)}`);
      await this.rateLimit.release(reservation.claim);
      throw error;
    }
  }

  async createSession(magicToken: string, response: Response) {
    const refreshToken = randomBytes(32).toString('base64url');
    const { data, error } = await this.supabase.admin.rpc('consume_app_magic_link', {
      p_token_hash: this.hash(magicToken),
      p_refresh_token_hash: this.hash(refreshToken),
      p_refresh_expires_at: new Date(Date.now() + this.refreshTokenTtlDays * 86_400_000).toISOString(),
    });
    const user = (data as AppUserRow[] | null)?.[0];
    if (error || !user) {
      throw new UnauthorizedException({
        code: 'AUTH_LINK_INVALID',
        message: 'El enlace venció, ya fue utilizado o no es válido.',
      });
    }

    this.writeCookies(response, user, refreshToken);
    return { user: this.mapUser(user) };
  }

  async verifyMagicLinkAndRedirect(magicToken: string, response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      await this.createSession(magicToken, response);
      return response.redirect(HttpStatus.SEE_OTHER, `${this.frontendUrl}/publications`);
    } catch (error) {
      this.logger.warn(`Enlace de acceso rechazado: ${this.errorMessage(error)}`);
      this.clearCookies(response);
      return response.redirect(
        HttpStatus.SEE_OTHER,
        `${this.frontendUrl}/publications?error_code=invalid_or_expired`,
      );
    }
  }

  async refresh(refreshToken: string | undefined, response: Response) {
    if (!refreshToken) throw new UnauthorizedException('Missing session');

    const nextToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlDays * 86_400_000).toISOString();
    const { data, error } = await this.supabase.admin.rpc('rotate_app_refresh_token', {
      p_current_token_hash: this.hash(refreshToken),
      p_next_token_hash: this.hash(nextToken),
      p_next_expires_at: expiresAt,
    });
    const user = (data as AppUserRow[] | null)?.[0];
    if (error || !user) {
      this.clearCookies(response);
      throw new UnauthorizedException('Session expired');
    }

    this.writeCookies(response, user, nextToken);
    return { user: this.mapUser(user) };
  }

  async clearSession(response: Response, refreshToken?: string) {
    if (refreshToken) {
      const { error } = await this.supabase.admin
        .from('app_refresh_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', this.hash(refreshToken))
        .is('revoked_at', null);
      if (error) this.logger.warn(`No se pudo revocar la sesión: ${error.message}`);
    }
    this.clearCookies(response);
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

  private writeCookies(response: Response, user: AppUserRow, refreshToken: string) {
    response.cookie(ACCESS_COOKIE, this.tokens.signAccessToken(user), {
      ...this.cookieOptions(),
      maxAge: this.tokens.accessTokenTtlSeconds * 1000,
    });
    response.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.refreshTokenTtlDays * 86_400_000,
    });
  }

  private clearCookies(response: Response) {
    response.clearCookie(ACCESS_COOKIE, this.cookieOptions());
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions() {
    return { httpOnly: true, secure: this.secureCookies, sameSite: 'lax' as const, path: '/' };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private mapUser(user: AppUserRow): AuthUser {
    return { id: user.id, email: user.email };
  }

  private positiveInteger(value: string | number | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
