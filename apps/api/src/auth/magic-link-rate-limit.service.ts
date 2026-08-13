import { createHash } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

interface RateLimitRow {
  allowed: boolean;
  retry_after_seconds: number;
  claim_token: string | null;
}

export interface MagicLinkClaim {
  emailHash: string;
  claimToken: string;
}

@Injectable()
export class MagicLinkRateLimitService {
  private readonly logger = new Logger(MagicLinkRateLimitService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async claim(email: string, cooldownSeconds: number) {
    const emailHash = this.hash(email);
    const { data, error } = await this.supabase.admin.rpc('claim_magic_link_send', {
      p_email_hash: emailHash,
      p_cooldown_seconds: cooldownSeconds,
    });

    if (error) {
      this.logger.error(`No se pudo reservar el envío SMTP: ${error.message}`);
      throw new ServiceUnavailableException({
        code: 'AUTH_RATE_LIMIT_UNAVAILABLE',
        message: 'El servicio de acceso no está disponible temporalmente. Inténtalo nuevamente.',
      });
    }

    const row = (data as RateLimitRow[] | null)?.[0];
    if (!row) {
      throw new ServiceUnavailableException({
        code: 'AUTH_RATE_LIMIT_UNAVAILABLE',
        message: 'El servicio de acceso no está disponible temporalmente. Inténtalo nuevamente.',
      });
    }

    if (!row.allowed || !row.claim_token) {
      return {
        allowed: false as const,
        retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || cooldownSeconds),
      };
    }

    return {
      allowed: true as const,
      claim: { emailHash, claimToken: row.claim_token },
    };
  }

  async release(claim: MagicLinkClaim) {
    const { error } = await this.supabase.admin.rpc('release_magic_link_send', {
      p_email_hash: claim.emailHash,
      p_claim_token: claim.claimToken,
    });
    if (error) this.logger.warn(`No se pudo liberar la reserva SMTP fallida: ${error.message}`);
  }

  private hash(email: string) {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  }
}
