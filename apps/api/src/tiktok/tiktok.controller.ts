import { Body, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { IsString } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { TikTokService } from './tiktok.service.js';

class CallbackDto { @IsString() code!: string; @IsString() state!: string; }
const PKCE_COOKIE = 'impulso_tiktok_pkce';

function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator >= 0 && pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return undefined;
}

@Controller('tiktok')
export class TikTokController {
  private readonly secureCookies: boolean;
  constructor(private readonly tiktok: TikTokService, config: ConfigService) {
    this.secureCookies = config.get<string>('NODE_ENV') === 'production';
  }
  @Get('status') status(@Req() req: AuthenticatedRequest) { return this.tiktok.connectionStatus(req.user.id); }
  @Get('authorize-url') authorize(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const authorization = this.tiktok.authorizeUrl(req.user.id);
    if (authorization.codeVerifier) {
      response.cookie(PKCE_COOKIE, authorization.codeVerifier, {
        httpOnly: true,
        secure: this.secureCookies,
        sameSite: 'lax',
        path: '/api/tiktok',
        maxAge: 10 * 60 * 1000,
      });
    }
    return { url: authorization.url };
  }
  @Post('callback') async callback(@Req() req: AuthenticatedRequest, @Body() dto: CallbackDto, @Res({ passthrough: true }) response: Response) {
    const codeVerifier = readCookie(req.headers.cookie, PKCE_COOKIE);
    try {
      return await this.tiktok.exchangeCode(req.user.id, dto.code, dto.state, codeVerifier);
    } finally {
      response.clearCookie(PKCE_COOKIE, { httpOnly: true, secure: this.secureCookies, sameSite: 'lax', path: '/api/tiktok' });
    }
  }
  @Delete('connection') disconnect(@Req() req: AuthenticatedRequest) { return this.tiktok.disconnect(req.user.id); }
}
