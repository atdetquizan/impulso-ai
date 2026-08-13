import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  readonly admin: SupabaseClient;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    this.admin = createClient(
      url,
      config.getOrThrow<string>('SUPABASE_SECRET_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
}
