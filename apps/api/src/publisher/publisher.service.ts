import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "../supabase/supabase.service.js";
import { TikTokService } from "../tiktok/tiktok.service.js";
import { MediaComposerService } from "./media-composer.service.js";

@Injectable()
export class PublisherService {
  private readonly logger = new Logger(PublisherService.name);
  private readonly enabled: boolean;
  constructor(
    config: ConfigService,
    private readonly db: SupabaseService,
    private readonly tiktok: TikTokService,
    private readonly media: MediaComposerService,
  ) {
    this.enabled = config.get("SCHEDULER_ENABLED", "true") === "true";
  }

  @Cron("*/30 * * * * *", {
    name: "publish-due-content",
    waitForCompletion: true,
  })
  async publishDue() {
    if (!this.enabled) return;
    const { data: due, error } = await this.db.admin
      .from("publications")
      .select("*,music_tracks(*)")
      .eq("status", "scheduled")
      .lte("scheduled_for", new Date().toISOString())
      .limit(5);
    if (error) throw error;
    for (const item of due ?? [])
      await this.publishOne(item).catch((failure) =>
        this.logger.error(failure),
      );
  }

  private async publishOne(item: Record<string, any>) {
    const claimed = await this.db.admin
      .from("publications")
      .update({ status: "publishing" })
      .eq("id", item.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed.data) return;
    try {
      const imagePath = item.composed_image_path ?? item.image_path;
      const [imageResult, musicResult] = await Promise.all([
        this.db.admin.storage.from("generated-images").download(imagePath),
        this.db.admin.storage
          .from("music")
          .download(item.music_tracks.storage_path),
      ]);
      if (imageResult.error) throw imageResult.error;
      if (musicResult.error) throw musicResult.error;
      const video = await this.media.compose(
        Buffer.from(await imageResult.data.arrayBuffer()),
        Buffer.from(await musicResult.data.arrayBuffer()),
        item.composed_image_path ? undefined : item.quote,
        item.brand_name ?? "IMPULSO IA",
      );
      const videoPath = `${item.user_id}/${item.id}.mp4`;
      const { error: uploadError } = await this.db.admin.storage
        .from("rendered-videos")
        .upload(videoPath, video, { contentType: "video/mp4", upsert: true });
      if (uploadError) throw uploadError;
      const publishId = await this.tiktok.publishVideo(
        item.user_id,
        video,
        `${item.caption}\n\n${(item.hashtags ?? []).join(" ")}`,
      );
      await this.db.admin
        .from("publications")
        .update({
          status: "published",
          video_path: videoPath,
          external_post_id: publishId,
          published_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", item.id);
      await this.db.admin
        .from("publication_events")
        .insert({
          publication_id: item.id,
          event_type: "published",
          from_status: "publishing",
          to_status: "published",
          metadata: { publish_id: publishId },
        });
      await this.syncBatch(item.batch_id);
    } catch (error) {
      await this.db.admin
        .from("publications")
        .update({
          status: "failed",
          error_message:
            error instanceof Error ? error.message : "Publish failed",
        })
        .eq("id", item.id);
      await this.db.admin
        .from("publication_events")
        .insert({
          publication_id: item.id,
          event_type: "publish_failed",
          from_status: "publishing",
          to_status: "failed",
        });
      await this.syncBatch(item.batch_id);
    }
  }

  private async syncBatch(batchId: string | null | undefined) {
    if (!batchId) return;
    const { data } = await this.db.admin
      .from("publications")
      .select("status")
      .eq("batch_id", batchId)
      .eq("is_current", true);
    const statuses = (data ?? []).map((row) => row.status);
    const status =
      statuses.length && statuses.every((value) => value === "published")
        ? "published"
        : statuses.some((value) => ["scheduled", "publishing"].includes(value))
          ? "scheduled"
          : statuses.some((value) => value === "failed")
            ? "failed"
            : "approved";
    await this.db.admin
      .from("publication_batches")
      .update({ status })
      .eq("id", batchId);
  }
}
