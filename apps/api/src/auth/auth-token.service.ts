import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
  iat: number;
  exp: number;
}

@Injectable()
export class AuthTokenService {
  private readonly secret: string;
  readonly accessTokenTtlSeconds: number;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('AUTH_TOKEN_SECRET');
    if (Buffer.byteLength(this.secret, 'utf8') < 32) {
      throw new Error('AUTH_TOKEN_SECRET debe tener al menos 32 caracteres aleatorios.');
    }
    this.accessTokenTtlSeconds = this.positiveInteger(
      config.get<string | number>('AUTH_ACCESS_TOKEN_TTL_SECONDS'),
      15 * 60,
    );
  }

  signAccessToken(user: { id: string; email: string }) {
    const now = Math.floor(Date.now() / 1000);
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const payload = this.encode({
      sub: user.id,
      email: user.email,
      type: 'access',
      iat: now,
      exp: now + this.accessTokenTtlSeconds,
    } satisfies AccessTokenPayload);
    const content = `${header}.${payload}`;
    return `${content}.${this.signature(content)}`;
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid session');

    const content = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(this.signature(content));
    const received = Buffer.from(parts[2]);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Invalid session');
    }

    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string };
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as AccessTokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (
        header.alg !== 'HS256' ||
        payload.type !== 'access' ||
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string' ||
        !Number.isInteger(payload.exp) ||
        payload.exp <= now
      ) {
        throw new Error('invalid payload');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  private signature(content: string) {
    return createHmac('sha256', this.secret).update(content).digest('base64url');
  }

  private encode(value: object) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private positiveInteger(value: string | number | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
