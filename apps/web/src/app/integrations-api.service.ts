import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import type { MusicTrack, TikTokConnectionStatus } from "@impulso/contracts";
import { environment } from "../environments/environment";

@Injectable({ providedIn: "root" })
export class IntegrationsApiService {
  constructor(private readonly http: HttpClient) {}

  async music() {
    const rows = await firstValueFrom(this.http.get<Record<string, any>[]>(`${environment.apiUrl}/music`));
    return rows.map((row): MusicTrack => ({
      id: row.id,
      name: row.name,
      durationSeconds: row.duration_seconds,
      licenseNotes: row.license_notes,
      source: row.source,
      aiProvider: row.ai_provider,
      validationStatus: row.validation_status,
      previewUrl: row.preview_url,
      active: row.active,
    }));
  }

  uploadMusic(form: FormData) {
    return firstValueFrom(this.http.post(`${environment.apiUrl}/music`, form));
  }

  tiktokStatus() {
    return firstValueFrom(this.http.get<TikTokConnectionStatus>(`${environment.apiUrl}/tiktok/status`));
  }

  async connectTikTok() {
    const { url } = await firstValueFrom(this.http.get<{ url: string }>(`${environment.apiUrl}/tiktok/authorize-url`));
    window.location.assign(url);
  }

  exchangeTikTokCode(code: string, state: string) {
    return firstValueFrom(this.http.post(`${environment.apiUrl}/tiktok/callback`, { code, state }));
  }

  disconnectTikTok() {
    return firstValueFrom(this.http.delete(`${environment.apiUrl}/tiktok/connection`));
  }
}
