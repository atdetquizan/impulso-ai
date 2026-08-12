import { Body, Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from './auth.guard.js';
import { Public } from './public.decorator.js';
import { AuthService } from './auth.service.js';
import { CreateSessionDto, MagicLinkDto } from './dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('magic-link')
  magicLink(@Body() dto: MagicLinkDto) {
    return this.auth.sendMagicLink(dto.email);
  }

  @Public()
  @Post('session')
  session(@Body() dto: CreateSessionDto, @Res({ passthrough: true }) response: Response) {
    return this.auth.createSession(dto.accessToken, dto.refreshToken, response);
  }

  @Public()
  @Post('refresh')
  refresh(@Headers('cookie') cookieHeader: string | undefined, @Res({ passthrough: true }) response: Response) {
    return this.auth.refresh(this.auth.readRefreshCookie(cookieHeader), response);
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    return this.auth.clearSession(response);
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return { user: { id: request.user.id, email: request.user.email ?? null } };
  }
}
