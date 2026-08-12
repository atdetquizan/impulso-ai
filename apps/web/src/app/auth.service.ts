import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AuthUser, CreateSessionRequest, MagicLinkRequest } from '@impulso/contracts';
import { environment } from '../environments/environment';

interface AuthResponse { user: AuthUser }

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthUser | null>(null);
  readonly initialized = signal(false);
  readonly ready: Promise<void>;

  constructor(private readonly http: HttpClient) {
    this.ready = this.initialize();
  }

  async sendMagicLink(email: string) {
    const body: MagicLinkRequest = { email };
    await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/magic-link`, body));
  }

  async signOut() {
    await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/logout`, {}));
    this.user.set(null);
  }

  private async initialize() {
    try {
      await this.consumeSupabaseCallback();
      const response = await firstValueFrom(this.http.get<AuthResponse>(`${environment.apiUrl}/auth/me`));
      this.user.set(response.user);
    } catch {
      this.user.set(null);
    } finally {
      this.initialized.set(true);
    }
  }

  private async consumeSupabaseCallback() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const error = params.get('error_description');
    if (error) throw new Error(error);
    if (!accessToken || !refreshToken) return;

    const body: CreateSessionRequest = { accessToken, refreshToken };
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${environment.apiUrl}/auth/session`, body));
    this.user.set(response.user);
    window.history.replaceState({}, document.title, '/');
  }
}
