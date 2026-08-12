import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { SupabaseService } from "../supabase/supabase.service.js";

const execFileAsync = promisify(execFile);
type AudioFile = { buffer: Buffer; mimetype: string; originalname: string; size: number };

@Injectable()
export class MusicService {
  private readonly ffprobe: string;

  constructor(private readonly db: SupabaseService, config: ConfigService) {
    const ffmpeg = config.get<string>("FFMPEG_PATH") ?? "ffmpeg";
    this.ffprobe = config.get<string>("FFPROBE_PATH") ?? ffmpeg.replace(/ffmpeg$/, "ffprobe");
  }

  async list(userId: string) {
    const { data, error } = await this.db.admin.from("music_tracks").select("*")
      .or(`owner_id.is.null,owner_id.eq.${userId}`).eq("active", true).order("created_at", { ascending: false });
    if (error) throw error;
    return Promise.all((data ?? []).map(async (row) => {
      const { data: signed } = await this.db.admin.storage.from("music").createSignedUrl(row.storage_path, 60 * 60);
      return { ...row, preview_url: signed?.signedUrl ?? null };
    }));
  }

  async upload(userId: string, file: AudioFile | undefined, fields: Record<string, string | undefined>) {
    if (!file) throw new BadRequestException("Selecciona un archivo de audio.");
    if (file.size > 30 * 1024 * 1024) throw new BadRequestException("El audio supera el límite de 30 MB.");
    if (!new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a"]).has(file.mimetype)) {
      throw new BadRequestException("Formato no compatible. Usa MP3, WAV o M4A.");
    }
    const name = fields.name?.trim();
    const licenseNotes = fields.licenseNotes?.trim();
    const source = fields.source === "ai_generated" ? "ai_generated" : "uploaded";
    if (!name) throw new BadRequestException("Escribe un nombre para la pista.");
    if (!licenseNotes) throw new BadRequestException("Indica la licencia o procedencia de la música.");
    if (source === "ai_generated" && !fields.aiProvider?.trim()) {
      throw new BadRequestException("Indica qué proveedor de IA generó la pista.");
    }

    const duration = await this.duration(file);
    if (!Number.isFinite(duration) || duration < 5 || duration > 600) {
      throw new BadRequestException("La pista debe durar entre 5 segundos y 10 minutos.");
    }
    const safeExtension = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp3";
    const id = crypto.randomUUID();
    const storagePath = `${userId}/${id}${safeExtension}`;
    const { error: uploadError } = await this.db.admin.storage.from("music").upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data, error } = await this.db.admin.from("music_tracks").insert({
      id,
      owner_id: userId,
      name,
      storage_path: storagePath,
      duration_seconds: Math.round(duration),
      license_notes: licenseNotes,
      source,
      ai_provider: source === "ai_generated" ? fields.aiProvider?.trim() : null,
      validation_status: "verified",
      mime_type: file.mimetype,
      active: true,
    }).select("*").single();
    if (error) {
      await this.db.admin.storage.from("music").remove([storagePath]);
      throw error;
    }
    return data;
  }

  async disable(userId: string, id: string) {
    const { data, error } = await this.db.admin.from("music_tracks").update({ active: false })
      .eq("id", id).eq("owner_id", userId).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException("Pista no encontrada.");
    return { disabled: true };
  }

  private async duration(file: AudioFile) {
    const dir = await mkdtemp(join(tmpdir(), "impulso-audio-"));
    const path = join(dir, `track${extname(file.originalname) || ".audio"}`);
    try {
      await writeFile(path, file.buffer);
      const { stdout } = await execFileAsync(this.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
      return Number(stdout.trim());
    } catch {
      throw new BadRequestException("No se pudo verificar el audio. Comprueba que el archivo no esté dañado.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
