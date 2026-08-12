import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import type {
  GenerateBatchRequest,
  Publication,
  PublicationBatch,
  SchedulePublicationRequest,
} from "@impulso/contracts";
import { environment } from "../environments/environment";

type ApiPublication = Record<string, any>;

@Injectable({ providedIn: "root" })
export class PublicationsApiService {
  constructor(private readonly http: HttpClient) {}
  private options(params?: HttpParams) {
    return { params };
  }
  private map(row: ApiPublication): Publication {
    return {
      id: row.id,
      batchId: row.batch_id,
      userId: row.user_id,
      theme: row.theme,
      tone: row.tone,
      quote: row.quote,
      caption: row.caption,
      hashtags: row.hashtags,
      imagePrompt: row.image_prompt,
      imagePath: row.image_path,
      backgroundImagePath: row.background_image_path,
      composedImagePath: row.composed_image_path,
      backgroundImageUrl: row.background_image_url,
      composedImageUrl: row.composed_image_url,
      templateId: row.template_id ?? "classic-dark",
      brandName: row.brand_name ?? "IMPULSO IA",
      videoPath: row.video_path,
      musicTrackId: row.music_track_id,
      status: row.status,
      scheduledFor: row.scheduled_for,
      approvedAt: row.approved_at,
      publishedAt: row.published_at,
      externalPostId: row.external_post_id,
      errorMessage: row.error_message,
      version: row.version ?? 1,
      isCurrent: row.is_current ?? true,
      supersedesId: row.supersedes_id,
      supersededAt: row.superseded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  private mapBatch(row: ApiPublication): PublicationBatch {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      theme: row.theme,
      tone: row.tone,
      brandName: row.brand_name ?? "IMPULSO IA",
      requestedCount: row.requested_count,
      generatedCount: row.generated_count,
      obsoleteCount: row.obsolete_count ?? 0,
      status: row.status,
      publications: (row.publications ?? []).map((item: ApiPublication) =>
        this.map(item),
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  async list(status?: string) {
    const params = status ? new HttpParams().set("status", status) : undefined;
    const rows = await firstValueFrom(
      this.http.get<ApiPublication[]>(
        `${environment.apiUrl}/publications`,
        this.options(params),
      ),
    );
    return rows.map((row) => this.map(row));
  }
  async listBatches() {
    const rows = await firstValueFrom(
      this.http.get<ApiPublication[]>(
        `${environment.apiUrl}/publication-batches`,
        this.options(),
      ),
    );
    return rows.map((row) => this.mapBatch(row));
  }
  async generate(body: GenerateBatchRequest) {
    const row = await firstValueFrom(
      this.http.post<ApiPublication>(
        `${environment.apiUrl}/publications/generate`,
        body,
        this.options(),
      ),
    );
    return this.mapBatch(row);
  }
  async generateNext(batchId: string) {
    const result = await firstValueFrom(this.http.post<{ publication: ApiPublication; batch: ApiPublication; complete: boolean }>(
      `${environment.apiUrl}/publication-batches/${batchId}/generate-next`, {}, this.options(),
    ));
    return { publication: this.map(result.publication), batch: this.mapBatch(result.batch), complete: result.complete };
  }
  async approve(id: string) {
    return firstValueFrom(
      this.http.patch(
        `${environment.apiUrl}/publications/${id}/approve`,
        {},
        this.options(),
      ),
    );
  }
  async reject(id: string) {
    return firstValueFrom(
      this.http.patch(
        `${environment.apiUrl}/publications/${id}/reject`,
        {},
        this.options(),
      ),
    );
  }
  async regenerate(id: string) {
    return firstValueFrom(
      this.http.post(
        `${environment.apiUrl}/publications/${id}/regenerate`,
        {},
        this.options(),
      ),
    );
  }
  async schedule(id: string, body: SchedulePublicationRequest) {
    return firstValueFrom(
      this.http.patch(
        `${environment.apiUrl}/publications/${id}/schedule`,
        body,
        this.options(),
      ),
    );
  }
  async approveBatch(id: string) {
    const row = await firstValueFrom(
      this.http.patch<ApiPublication>(
        `${environment.apiUrl}/publication-batches/${id}/approve`,
        {},
        this.options(),
      ),
    );
    return this.mapBatch(row);
  }
}
