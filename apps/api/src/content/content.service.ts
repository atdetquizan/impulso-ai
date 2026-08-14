import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MediaComposerService } from "../publisher/media-composer.service.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import {
  CONTENT_AI_PROVIDER,
  type ContentAiProvider,
} from "./content-ai.provider.js";
import type { GenerateBatchDto, ScheduleBatchDto, ScheduleDto } from "./dto.js";

type DatabaseRow = Record<string, any>;

@Injectable()
export class ContentService {
  constructor(
    private readonly db: SupabaseService,
    private readonly media: MediaComposerService,
    @Inject(CONTENT_AI_PROVIDER) private readonly ai: ContentAiProvider,
  ) {}

  async list(userId: string, status?: string) {
    let query = this.db.admin
      .from("publications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return Promise.all((data ?? []).map((row) => this.withPreviewUrls(row)));
  }

  async listBatches(userId: string) {
    const { data, error } = await this.db.admin
      .from("publication_batches")
      .select("*,publications(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Promise.all(
      (data ?? []).map((batch) => this.withBatchPreviewUrls(batch)),
    );
  }

  async findBatch(userId: string, id: string) {
    const { data, error } = await this.db.admin
      .from("publication_batches")
      .select("*,publications(*)")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new NotFoundException("Paquete no encontrado.");
    return this.withBatchPreviewUrls(data);
  }

  async generateBatch(userId: string, dto: GenerateBatchDto) {
    const { data: batch, error: batchError } = await this.db.admin
      .from("publication_batches")
      .insert({
        user_id: userId,
        name: dto.name?.trim() || dto.theme.trim(),
        theme: dto.theme,
        tone: dto.tone,
        brand_name: dto.brandName.trim(),
        requested_count: dto.count,
        status: "generating",
      })
      .select("*")
      .single();
    if (batchError) throw batchError;

    return this.withBatchPreviewUrls({ ...batch, publications: [] });
  }

  async generateNext(userId: string, batchId: string) {
    const batch = await this.findBatch(userId, batchId);
    const { data: existing, error: existingError } = await this.db.admin
      .from("publications")
      .select("id,quote,status")
      .eq("batch_id", batchId)
      .eq("user_id", userId)
      .eq("is_current", true);
    if (existingError) throw existingError;
    if ((existing ?? []).length >= batch.requested_count) {
      throw new BadRequestException("El paquete ya alcanzó la cantidad solicitada.");
    }
    const index = (existing ?? []).length;
    const avoid = (existing ?? []).map((row) => row.quote).filter(Boolean);
    const concept = await this.ai.generateConcept(batch.theme, batch.tone, avoid);
    const { data: row, error: insertError } = await this.db.admin
      .from("publications")
      .insert({
        batch_id: batchId,
        user_id: userId,
        theme: batch.theme,
        tone: batch.tone,
        brand_name: batch.brand_name,
        quote: concept.quote,
        caption: concept.caption,
        hashtags: concept.hashtags,
        image_prompt: concept.imagePrompt,
        template_id: "editorial-glow",
        status: "generating",
        generation_metadata: {
          ai_provider: this.ai.providerName,
          text_model: this.ai.textModel,
          image_model: this.ai.imageModel,
          batch_index: index,
        },
      })
      .select("*")
      .single();
    if (insertError) throw insertError;
    try {
      const generated = await this.renderPublication(userId, batchId, row, concept);
      const generatedCount = index + 1;
      const complete = generatedCount >= batch.requested_count;
      const { error: batchError } = await this.db.admin
        .from("publication_batches")
        .update({ generated_count: generatedCount, status: complete ? "pending_review" : "generating" })
        .eq("id", batchId)
        .eq("user_id", userId);
      if (batchError) throw batchError;
      return { publication: await this.withPreviewUrls(generated), batch: await this.findBatch(userId, batchId), complete };
    } catch (error) {
      await this.db.admin.from("publications").update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Generation failed",
      }).eq("id", row.id);
      await this.db.admin.from("publication_batches").update({ status: "failed" }).eq("id", batchId);
      throw error;
    }
  }

  async approve(userId: string, id: string) {
    const data = await this.transition(
      userId,
      id,
      ["pending_review"],
      "approved",
      { approved_at: new Date().toISOString(), approved_by: userId },
      "approved",
    );
    await this.syncBatchStatus(data.batch_id);
    return this.withPreviewUrls(data);
  }

  async approveBatch(userId: string, batchId: string) {
    await this.findBatch(userId, batchId);
    const { data: pending, error: pendingError } = await this.db.admin
      .from("publications")
      .select("id")
      .eq("batch_id", batchId)
      .eq("user_id", userId)
      .eq("is_current", true)
      .eq("status", "pending_review");
    if (pendingError) throw pendingError;
    if (!pending?.length) {
      throw new BadRequestException(
        "El paquete no tiene publicaciones pendientes.",
      );
    }

    const approvedAt = new Date().toISOString();
    const { error } = await this.db.admin
      .from("publications")
      .update({
        status: "approved",
        approved_at: approvedAt,
        approved_by: userId,
      })
      .eq("batch_id", batchId)
      .eq("user_id", userId)
      .eq("is_current", true)
      .eq("status", "pending_review");
    if (error) throw error;
    await Promise.all(
      pending.map((row) =>
        this.event(row.id, userId, "approved", "pending_review", "approved", {
          batch_id: batchId,
        }),
      ),
    );
    await this.db.admin
      .from("publication_batches")
      .update({ status: "approved" })
      .eq("id", batchId)
      .eq("user_id", userId);
    return this.findBatch(userId, batchId);
  }

  async reject(userId: string, id: string) {
    const data = await this.transition(
      userId,
      id,
      ["pending_review", "approved"],
      "rejected",
      {},
      "rejected",
    );
    await this.syncBatchStatus(data.batch_id);
    return this.withPreviewUrls(data);
  }

  async regenerate(userId: string, id: string) {
    const current = await this.findOwned(userId, id);
    if (!["pending_review", "rejected", "failed"].includes(current.status) || current.is_current === false) {
      throw new BadRequestException("Solo puedes regenerar la versión vigente de una publicación pendiente, rechazada o con error.");
    }
    try {
      const concept = await this.ai.generateConcept(
        current.theme,
        current.tone,
        [current.quote],
      );
      const background = await this.ai.generateImage(concept.imagePrompt);
      const { data: replacement, error: insertError } = await this.db.admin
        .from("publications")
        .insert({
          batch_id: current.batch_id,
          user_id: userId,
          theme: current.theme,
          tone: current.tone,
          brand_name: current.brand_name ?? "IMPULSO IA",
          quote: concept.quote,
          caption: concept.caption,
          hashtags: concept.hashtags,
          image_prompt: concept.imagePrompt,
          template_id: current.template_id ?? "editorial-glow",
          status: "generating",
          version: Number(current.version ?? 1) + 1,
          supersedes_id: current.id,
          is_current: true,
          generation_metadata: {
            ai_provider: this.ai.providerName,
            text_model: this.ai.textModel,
            image_model: this.ai.imageModel,
          },
        })
        .select("*")
        .single();
      if (insertError) throw insertError;
      const data = await this.renderPublication(userId, current.batch_id, replacement, concept, background);
      const { error: obsoleteError } = await this.db.admin.from("publications").update({
        status: "obsolete",
        is_current: false,
        superseded_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", userId);
      if (obsoleteError) throw obsoleteError;
      await this.event(id, userId, "superseded", current.status, "obsolete", { replacement_id: data.id });
      await this.event(data.id, userId, "regenerated", "generating", "pending_review", { supersedes_id: id });
      await this.syncBatchStatus(data.batch_id);
      return this.withPreviewUrls(data);
    } catch (error) {
      await this.syncBatchStatus(current.batch_id);
      throw error;
    }
  }

  async schedule(userId: string, id: string, dto: ScheduleDto) {
    if (new Date(dto.scheduledFor).getTime() <= Date.now()) {
      throw new BadRequestException("scheduledFor must be in the future");
    }
    const [{ data: track }, { data: connection }] = await Promise.all([
      this.db.admin.from("music_tracks").select("id,active,validation_status,storage_path").eq("id", dto.musicTrackId).eq("active", true).eq("validation_status", "verified").maybeSingle(),
      this.db.admin.from("tiktok_connections").select("id").eq("user_id", userId).maybeSingle(),
    ]);
    if (!track) throw new BadRequestException("La pista no existe o aún no fue verificada. Selecciona una pista válida en Música.");
    if (!connection) throw new BadRequestException("Conecta tu cuenta de TikTok antes de programar la publicación.");
    const data = await this.transition(
      userId,
      id,
      ["approved"],
      "scheduled",
      {
        scheduled_for: dto.scheduledFor,
        music_track_id: dto.musicTrackId,
      },
      "scheduled",
    );
    await this.syncBatchStatus(data.batch_id);
    return this.withPreviewUrls(data);
  }

  async scheduleBatch(userId: string, batchId: string, dto: ScheduleBatchDto) {
    const startAt = new Date(dto.startAt);
    if (startAt.getTime() <= Date.now()) {
      throw new BadRequestException("La fecha inicial debe estar en el futuro.");
    }

    const [{ data: publications, error: publicationsError }, { data: track }, { data: connection }] =
      await Promise.all([
        this.db.admin
          .from("publications")
          .select("id,status")
          .eq("batch_id", batchId)
          .eq("user_id", userId)
          .eq("is_current", true)
          .order("created_at", { ascending: true }),
        this.db.admin
          .from("music_tracks")
          .select("id")
          .eq("id", dto.musicTrackId)
          .eq("active", true)
          .eq("validation_status", "verified")
          .maybeSingle(),
        this.db.admin
          .from("tiktok_connections")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
    if (publicationsError) throw publicationsError;
    if (!publications?.length) throw new NotFoundException("Paquete no encontrado o vacío.");
    if (publications.some((publication: DatabaseRow) => publication.status !== "approved")) {
      throw new BadRequestException("Todas las publicaciones vigentes del paquete deben estar aprobadas.");
    }
    if (!track) throw new BadRequestException("Selecciona una pista activa y verificada.");
    if (!connection) throw new BadRequestException("Conecta tu cuenta de TikTok antes de programar el paquete.");

    for (const [index, publication] of publications.entries()) {
      const scheduledFor = new Date(
        startAt.getTime() + index * dto.intervalMinutes * 60_000,
      ).toISOString();
      await this.transition(
        userId,
        publication.id,
        ["approved"],
        "scheduled",
        { scheduled_for: scheduledFor, music_track_id: dto.musicTrackId },
        "batch_scheduled",
      );
    }
    await this.syncBatchStatus(batchId);
    return this.findBatch(userId, batchId);
  }

  async retryPublication(userId: string, id: string) {
    const current = await this.findOwned(userId, id);
    if (current.status !== "failed") {
      throw new BadRequestException("Solo se pueden reintentar publicaciones con error.");
    }
    if (!current.approved_at || !current.music_track_id || !(current.composed_image_path || current.image_path)) {
      throw new BadRequestException("Esta publicación falló durante la generación. Regenera el contenido antes de publicarlo.");
    }
    const [{ data: track }, { data: connection }] = await Promise.all([
      this.db.admin.from("music_tracks").select("id").eq("id", current.music_track_id).eq("active", true).eq("validation_status", "verified").maybeSingle(),
      this.db.admin.from("tiktok_connections").select("id").eq("user_id", userId).maybeSingle(),
    ]);
    if (!track) throw new BadRequestException("La música usada ya no está disponible. Vuelve a aprobar y programar con otra pista.");
    if (!connection) throw new BadRequestException("Vuelve a conectar TikTok antes de reintentar.");
    const data = await this.transition(
      userId,
      id,
      ["failed"],
      "scheduled",
      { scheduled_for: new Date().toISOString(), error_message: null },
      "publish_retry_requested",
    );
    await this.syncBatchStatus(data.batch_id);
    return this.withPreviewUrls(data);
  }

  private async findOwned(userId: string, id: string) {
    const { data, error } = await this.db.admin
      .from("publications")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new NotFoundException("Publication not found");
    return data;
  }

  private async transition(
    userId: string,
    id: string,
    allowed: string[],
    next: string,
    patch: Record<string, unknown>,
    eventType: string,
  ) {
    const current = await this.findOwned(userId, id);
    if (!allowed.includes(current.status)) {
      throw new BadRequestException(`Cannot move ${current.status} to ${next}`);
    }
    const { data, error } = await this.db.admin
      .from("publications")
      .update({ ...patch, status: next })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw error;
    await this.event(id, userId, eventType, current.status, next);
    return data;
  }

  private async syncBatchStatus(batchId: string | null | undefined) {
    if (!batchId) return;
    const { data } = await this.db.admin
      .from("publications")
      .select("status")
      .eq("batch_id", batchId)
      .eq("is_current", true);
    const statuses = (data ?? []).map((row) => row.status);
    if (!statuses.length) return;
    let status = "pending_review";
    if (statuses.every((value) => value === "published")) status = "published";
    else if (
      statuses.some((value) => ["scheduled", "publishing"].includes(value))
    ) {
      status = "scheduled";
    } else if (statuses.every((value) => value === "approved"))
      status = "approved";
    else if (statuses.some((value) => value === "generating"))
      status = "generating";
    else if (statuses.every((value) => value === "failed")) status = "failed";
    await this.db.admin
      .from("publication_batches")
      .update({ status })
      .eq("id", batchId);
  }

  private async withBatchPreviewUrls(batch: DatabaseRow): Promise<DatabaseRow> {
    const publications = await Promise.all(
      (batch.publications ?? []).filter((row: DatabaseRow) => row.is_current !== false && row.status !== "obsolete").map((row: DatabaseRow) =>
        this.withPreviewUrls(row),
      ),
    );
    const obsoleteCount = (batch.publications ?? []).filter((row: DatabaseRow) => row.is_current === false || row.status === "obsolete").length;
    return { ...batch, generated_count: publications.filter((row) => row.composed_image_path).length, publications, obsolete_count: obsoleteCount };
  }

  private async renderPublication(
    userId: string,
    batchId: string | null,
    row: DatabaseRow,
    concept: { quote: string; imagePrompt: string },
    suppliedBackground?: Buffer,
  ) {
    const background = suppliedBackground ?? await this.ai.generateImage(concept.imagePrompt);
    const folder = batchId ? `${batchId}/` : "";
    const suffix = `v${row.version ?? 1}`;
    const backgroundPath = `${userId}/${folder}${row.id}-${suffix}-background.png`;
    const composedPath = `${userId}/${folder}${row.id}-${suffix}-composed.png`;
    const { error: backgroundError } = await this.db.admin.storage.from("generated-images").upload(backgroundPath, background, { contentType: "image/png", upsert: true });
    if (backgroundError) throw backgroundError;
    const composed = await this.media.composeImage(background, concept.quote, row.brand_name ?? "IMPULSO IA");
    const { error: composedError } = await this.db.admin.storage.from("generated-images").upload(composedPath, composed, { contentType: "image/png", upsert: true });
    if (composedError) throw composedError;
    const { data, error } = await this.db.admin.from("publications").update({
      background_image_path: backgroundPath,
      composed_image_path: composedPath,
      image_path: composedPath,
      status: "pending_review",
      error_message: null,
    }).eq("id", row.id).eq("user_id", userId).select("*").single();
    if (error) throw error;
    await this.event(row.id, userId, "generated", "generating", "pending_review", { batch_id: batchId });
    return data;
  }

  private async withPreviewUrls(row: DatabaseRow) {
    const backgroundPath = row.background_image_path as string | null;
    const composedPath = (row.composed_image_path ?? row.image_path) as
      string | null;
    const [backgroundImageUrl, composedImageUrl] = await Promise.all([
      this.signedImageUrl(backgroundPath),
      this.signedImageUrl(composedPath),
    ]);
    return {
      ...row,
      background_image_url: backgroundImageUrl,
      composed_image_url: composedImageUrl,
    };
  }

  private async signedImageUrl(path: string | null) {
    if (!path) return null;
    const { data, error } = await this.db.admin.storage
      .from("generated-images")
      .createSignedUrl(path, 60 * 60);
    return error ? null : data.signedUrl;
  }

  private async event(
    publicationId: string,
    actorId: string | null,
    eventType: string,
    fromStatus: string | null,
    toStatus: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    await this.db.admin.from("publication_events").insert({
      publication_id: publicationId,
      actor_id: actorId,
      event_type: eventType,
      from_status: fromStatus,
      to_status: toStatus,
      metadata,
    });
  }
}
