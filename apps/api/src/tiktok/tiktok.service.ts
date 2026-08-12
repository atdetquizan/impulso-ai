import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service.js';
import { TokenCryptoService } from './token-crypto.service.js';

type TokenResponse = { access_token: string; refresh_token: string; open_id: string; expires_in: number; refresh_expires_in?: number; scope: string };

@Injectable()
export class TikTokService {
  private readonly clientKey?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri?: string;
  private readonly pkceEnabled: boolean;
  constructor(config: ConfigService, private readonly db: SupabaseService, private readonly crypto: TokenCryptoService) {
    this.clientKey = config.get<string>('TIKTOK_CLIENT_KEY');
    this.clientSecret = config.get<string>('TIKTOK_CLIENT_SECRET');
    this.redirectUri = config.get<string>('TIKTOK_REDIRECT_URI');
    const loopbackRedirect = this.redirectUri
      ? ['localhost', '127.0.0.1'].includes(new URL(this.redirectUri).hostname)
      : false;
    this.pkceEnabled = config.get<string>('TIKTOK_PKCE_ENABLED', loopbackRedirect ? 'true' : 'false') === 'true';
  }

  private get configured() { return Boolean(this.clientKey && this.clientSecret && this.redirectUri); }

  private requireConfiguration() {
    if (!this.configured) throw new BadRequestException('TikTok no está configurado en el backend. Revisa CLIENT_KEY, CLIENT_SECRET y REDIRECT_URI.');
  }

  authorizeUrl(userId: string) {
    this.requireConfiguration();
    const state = this.crypto.createState(userId);
    const params = new URLSearchParams({ client_key: this.clientKey!, response_type: 'code', scope: 'user.info.basic,video.publish,video.upload', redirect_uri: this.redirectUri!, state });
    const codeVerifier = this.pkceEnabled ? randomBytes(48).toString('base64url') : undefined;
    if (codeVerifier) {
      params.set('code_challenge', createHash('sha256').update(codeVerifier).digest('hex'));
      params.set('code_challenge_method', 'S256');
    }
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${params}`, codeVerifier };
  }

  async exchangeCode(userId: string, code: string, state: string, codeVerifier?: string) {
    this.requireConfiguration();
    if (!this.crypto.verifyState(state, userId)) throw new BadGatewayException('Invalid or expired OAuth state');
    if (this.pkceEnabled && !codeVerifier) {
      throw new BadRequestException('La sesión PKCE de TikTok venció. Inicia nuevamente la conexión.');
    }
    const tokenBody = new URLSearchParams({ client_key: this.clientKey!, client_secret: this.clientSecret!, code, grant_type: 'authorization_code', redirect_uri: this.redirectUri! });
    if (codeVerifier) tokenBody.set('code_verifier', codeVerifier);
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    const tokens = await response.json() as TokenResponse & { error?: string; error_description?: string; log_id?: string };
    if (!response.ok || !tokens.access_token) {
      throw new BadGatewayException(tokens.error_description ?? `TikTok OAuth falló con estado ${response.status}.`);
    }
    const displayName = await this.fetchDisplayName(tokens.access_token);
    const { error } = await this.db.admin.from('tiktok_connections').upsert({
      user_id: userId, open_id: tokens.open_id,
      display_name: displayName,
      access_token_encrypted: this.crypto.encrypt(tokens.access_token),
      refresh_token_encrypted: this.crypto.encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope.split(','),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return { connected: true };
  }

  async connectionStatus(userId: string) {
    const { data } = await this.db.admin.from('tiktok_connections').select('display_name,expires_at,scopes').eq('user_id', userId).maybeSingle();
    return { configured: this.configured, connected: Boolean(data), pkceRequired: this.pkceEnabled, ...data };
  }

  async disconnect(userId: string) {
    const { error } = await this.db.admin.from('tiktok_connections').delete().eq('user_id', userId);
    if (error) throw error;
    return { connected: false };
  }

  async publishVideo(userId: string, video: Buffer, caption: string) {
    this.requireConfiguration();
    const { data: connection } = await this.db.admin.from('tiktok_connections').select('*').eq('user_id', userId).single();
    if (!connection) throw new NotFoundException('TikTok account is not connected');
    const token = await this.validAccessToken(connection);
    const init = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        post_info: { title: caption.slice(0, 2200), privacy_level: 'SELF_ONLY', disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: 'FILE_UPLOAD', video_size: video.byteLength, chunk_size: video.byteLength, total_chunk_count: 1 },
      }),
    });
    const payload = await init.json() as { data?: { publish_id: string; upload_url: string }; error?: { message?: string } };
    if (!init.ok || !payload.data) throw new BadGatewayException(payload.error?.message ?? 'TikTok publish initialization failed');
    const upload = await fetch(payload.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.byteLength), 'Content-Range': `bytes 0-${video.byteLength - 1}/${video.byteLength}` }, body: video as unknown as BodyInit });
    if (!upload.ok) throw new BadGatewayException(`TikTok media upload failed: ${upload.status}`);
    return payload.data.publish_id;
  }

  private async validAccessToken(connection: Record<string, any>) {
    if (new Date(connection.expires_at).getTime() > Date.now() + 5 * 60 * 1000) {
      return this.crypto.decrypt(connection.access_token_encrypted);
    }
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: this.clientKey!,
        client_secret: this.clientSecret!,
        grant_type: 'refresh_token',
        refresh_token: this.crypto.decrypt(connection.refresh_token_encrypted),
      }),
    });
    const tokens = await response.json() as TokenResponse & { error_description?: string };
    if (!response.ok || !tokens.access_token) throw new BadGatewayException(tokens.error_description ?? 'No se pudo renovar la conexión con TikTok.');
    const { error } = await this.db.admin.from('tiktok_connections').update({
      access_token_encrypted: this.crypto.encrypt(tokens.access_token),
      refresh_token_encrypted: this.crypto.encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope.split(','),
    }).eq('id', connection.id);
    if (error) throw error;
    return tokens.access_token;
  }

  private async fetchDisplayName(token: string) {
    try {
      const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json() as { data?: { user?: { display_name?: string } } };
      return payload.data?.user?.display_name ?? null;
    } catch { return null; }
  }
}
