import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module.js';
import { AuthController } from './auth.controller.js';
import { AuthEmailService } from './auth-email.service.js';
import { AuthService } from './auth.service.js';
import { MagicLinkRateLimitService } from './magic-link-rate-limit.service.js';

@Module({
  imports: [SupabaseModule],
  controllers: [AuthController],
  providers: [AuthService, AuthEmailService, MagicLinkRateLimitService],
})
export class AuthModule {}
