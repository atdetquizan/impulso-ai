import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type {
  AuthUser,
  CreateSessionRequest,
  MagicLinkRequest,
  MagicLinkResponse,
} from '@impulso/contracts';
import { environment } from '../environments/environment';

interface AuthResponse { user: AuthUser }
type LoginNoticeKind = 'error' | 'info';
type CallbackResult = 'none' | 'success' | 'error';

interface LoginNotice {
  kind: LoginNoticeKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthUser | null>(null);
  readonly initialized = signal(false);
  readonly magicLinkRetryAfterSeconds = signal(0);
  readonly loginNotice = signal<LoginNotice | null>(null);
  readonly ready: Promise<void>;
  private readonly defaultMagicLinkCooldownSeconds = 60;
  private readonly unknownRateLimitRetrySeconds = 10;
  private readonly magicLinkCooldownStorageKey = 'impulso.magicLinkCooldownUntil';
  private magicLinkCooldownUntil = 0;
  private magicLinkCooldownTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly http: HttpClient, private readonly router: Router) {
    this.restoreMagicLinkCooldown();
    this.ready = this.initialize();
  }

  async sendMagicLink(email: string) {
    const body: MagicLinkRequest = { email };
    this.loginNotice.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<MagicLinkResponse>(`${environment.apiUrl}/auth/magic-link`, body),
      );
      this.startMagicLinkCooldown(response.retryAfterSeconds);
      this.loginNotice.set({
        kind: 'info',
        message: 'Te enviamos un nuevo enlace. Revisa también la carpeta de correo no deseado.',
      });
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 429) {
        const serverRetryAfterSeconds = this.readRetryAfterSeconds(error);
        if (serverRetryAfterSeconds !== null) {
          this.startMagicLinkCooldown(serverRetryAfterSeconds);
        } else if (this.magicLinkRetryAfterSeconds() === 0) {
          this.startMagicLinkCooldown(this.unknownRateLimitRetrySeconds);
        }
      }
      throw error;
    }
  }

  async signOut() {
    await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/logout`, {}));
    this.user.set(null);
  }

  private async initialize() {
    try {
      const callbackResult = await this.consumeAppCallback();
      if (callbackResult !== 'none') return;

      const response = await firstValueFrom(this.http.get<AuthResponse>(`${environment.apiUrl}/auth/me`));
      this.user.set(response.user);
    } catch (error) {
      if (!(error instanceof HttpErrorResponse && error.status === 401)) {
        console.error('Error al recuperar la sesión de usuario:', error);
        this.loginNotice.set({
          kind: 'error',
          message: 'No pudimos recuperar tu sesión. Intenta solicitar un nuevo enlace de acceso.',
        });
      }
      this.user.set(null);
    } finally {
      this.initialized.set(true);
    }
  }

  private async consumeAppCallback(): Promise<CallbackResult> {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    const value = (name: string) => hashParams.get(name) ?? queryParams.get(name);
    const token = value('token');
    const errorCode = value('error_code');
    const errorDescription = value('error_description');
    const isAuthCallback = window.location.pathname === '/auth/callback';

    if (errorCode || errorDescription) {
      this.clearAuthCallbackUrl();
      this.user.set(null);
      this.loginNotice.set({
        kind: 'error',
        message: this.callbackErrorMessage(errorCode, errorDescription),
      });
      return 'error';
    }

    if (!token) {
      if (!isAuthCallback) return 'none';

      this.clearAuthCallbackUrl();
      this.user.set(null);
      this.loginNotice.set({
        kind: 'error',
        message: 'El enlace de acceso está incompleto o ya no es válido. Solicita uno nuevo.',
      });
      return 'error';
    }

    try {
      const body: CreateSessionRequest = { token };
      const response = await firstValueFrom(
        this.http.post<AuthResponse>(`${environment.apiUrl}/auth/session`, body),
      );
      this.user.set(response.user);
      this.loginNotice.set(null);
      this.clearAuthCallbackUrl();
      return 'success';
    } catch (error) {
      console.error('Error al crear la sesión de usuario:', error);
      this.clearAuthCallbackUrl();
      this.user.set(null);
      this.loginNotice.set({
        kind: 'error',
        message: 'No pudimos iniciar la sesión con este enlace. Puede haber vencido o haber sido utilizado. Solicita uno nuevo.',
      });
      return 'error';
    }
  }

  private callbackErrorMessage(errorCode: string | null, description: string | null) {
    const normalizedError = `${errorCode ?? ''} ${description ?? ''}`.toLowerCase();
    if (
      normalizedError.includes('otp_expired') ||
      normalizedError.includes('expired') ||
      normalizedError.includes('invalid')
    ) {
      return 'El enlace de acceso venció o ya fue utilizado. Solicita uno nuevo para continuar.';
    }
    return 'No pudimos validar el enlace de acceso. Solicita uno nuevo e inténtalo nuevamente.';
  }

  private clearAuthCallbackUrl() {
    window.history.replaceState({}, document.title, '/publications');
    void this.router.navigateByUrl('/publications', { replaceUrl: true });
  }

  private restoreMagicLinkCooldown() {
    try {
      const storedUntil = Number(localStorage.getItem(this.magicLinkCooldownStorageKey));
      if (Number.isFinite(storedUntil) && storedUntil > Date.now()) {
        this.applyMagicLinkCooldown(storedUntil);
      } else {
        localStorage.removeItem(this.magicLinkCooldownStorageKey);
      }
    } catch {
      // El contador sigue funcionando en memoria cuando el almacenamiento está bloqueado.
    }
  }

  private startMagicLinkCooldown(seconds: number) {
    const safeSeconds = Number.isFinite(seconds) && seconds > 0
      ? Math.ceil(seconds)
      : this.defaultMagicLinkCooldownSeconds;
    const cooldownUntil = Math.max(
      this.magicLinkCooldownUntil,
      Date.now() + safeSeconds * 1000,
    );
    this.applyMagicLinkCooldown(cooldownUntil);
  }

  private applyMagicLinkCooldown(cooldownUntil: number) {
    this.magicLinkCooldownUntil = cooldownUntil;
    try {
      localStorage.setItem(this.magicLinkCooldownStorageKey, String(cooldownUntil));
    } catch {
      // El timestamp no contiene datos sensibles; localStorage es solo una mejora de UX.
    }

    this.clearMagicLinkCooldownTimer();
    this.updateMagicLinkCooldown();
    if (this.magicLinkRetryAfterSeconds() > 0) {
      this.magicLinkCooldownTimer = setInterval(() => this.updateMagicLinkCooldown(), 1000);
    }
  }

  private updateMagicLinkCooldown() {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((this.magicLinkCooldownUntil - Date.now()) / 1000),
    );
    this.magicLinkRetryAfterSeconds.set(remainingSeconds);
    if (remainingSeconds === 0) {
      this.magicLinkCooldownUntil = 0;
      this.clearMagicLinkCooldownTimer();
      try {
        localStorage.removeItem(this.magicLinkCooldownStorageKey);
      } catch {
        // No se requiere persistencia para finalizar el contador en memoria.
      }
    }
  }

  private clearMagicLinkCooldownTimer() {
    if (this.magicLinkCooldownTimer) {
      clearInterval(this.magicLinkCooldownTimer);
      this.magicLinkCooldownTimer = undefined;
    }
  }

  private readRetryAfterSeconds(error: HttpErrorResponse) {
    const value = error.error && typeof error.error === 'object'
      ? Number(error.error.retryAfterSeconds)
      : Number.NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
}
