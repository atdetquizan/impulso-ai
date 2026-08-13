import { HttpErrorResponse } from "@angular/common/http";
import { computed, inject, Injectable, signal } from "@angular/core";
import { Router } from "@angular/router";
import type {
  MusicTrack,
  Publication,
  PublicationBatch,
  PublicationBatchStatus,
  PublicationStatus,
  TikTokConnectionStatus,
} from "@impulso/contracts";
import { AuthService } from "./auth.service";
import { IntegrationsApiService } from "./integrations-api.service";
import { PublicationsApiService } from "./publications-api.service";

export type PublicationFilter = "all" | PublicationStatus;
export type AsyncAction =
  | "login"
  | "logout"
  | "load"
  | "generate"
  | "regenerate"
  | "reject"
  | "approve"
  | "approveBatch"
  | "schedule"
  | "retry"
  | "musicUpload"
  | "tiktok";
type MessageKind = "success" | "error";

@Injectable({ providedIn: "root" })
export class WorkspaceStore {
  readonly auth = inject(AuthService);
  private readonly api = inject(PublicationsApiService);
  private readonly integrations = inject(IntegrationsApiService);
  private readonly router = inject(Router);

  readonly items = signal<Publication[]>([]);
  readonly batches = signal<PublicationBatch[]>([]);
  readonly loading = signal(false);
  readonly pendingActions = signal<ReadonlySet<AsyncAction>>(new Set());
  readonly busy = computed(() => this.pendingActions().size > 0);
  readonly filter = signal<PublicationFilter>("pending_review");
  readonly selected = signal<Publication | null>(null);
  readonly selectedBatch = signal<PublicationBatch | null>(null);
  readonly musicTracks = signal<MusicTrack[]>([]);
  readonly tiktok = signal<TikTokConnectionStatus>({
    configured: false,
    connected: false,
  });
  readonly generationProgress = signal<{ current: number; total: number } | null>(null);
  readonly message = signal("");
  readonly messageKind = signal<MessageKind>("success");
  readonly filtered = computed(() =>
    this.filter() === "all"
      ? this.items()
      : this.items().filter((item) => item.status === this.filter()),
  );

  batchName = "";
  brandName = "IMPULSO IA";
  theme = "Motivación diaria";
  tone: "cercano" | "energico" | "reflexivo" = "cercano";
  count: 2 | 3 = 3;
  scheduledFor = "";
  musicTrackId = "";
  musicName = "";
  musicLicense = "";
  musicSource: "uploaded" | "ai_generated" = "uploaded";
  musicAiProvider = "";
  musicFile: File | null = null;
  private messageTimer?: ReturnType<typeof setTimeout>;
  private initialized = false;

  readonly tabs: { value: PublicationFilter; label: string }[] = [
    { value: "pending_review", label: "Pendientes" },
    { value: "approved", label: "Aprobadas" },
    { value: "scheduled", label: "Programadas" },
    { value: "published", label: "Publicadas" },
    { value: "failed", label: "Con error" },
    { value: "obsolete", label: "Obsoletas" },
    { value: "all", label: "Todas" },
  ];

  async initializeWorkspace() {
    if (this.initialized) return;
    this.initialized = true;
    await this.consumeTikTokCallback();
    await Promise.all([this.load(), this.loadIntegrations()]);
  }

  countStatus(value: PublicationFilter) {
    return value === "all"
      ? this.items().length
      : this.items().filter((item) => item.status === value).length;
  }

  isLoading(action: AsyncAction) {
    return this.pendingActions().has(action);
  }

  async login(email: string) {
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return this.flash("Ingresa un correo electrónico válido.", "error");
    }
    const retryAfterSeconds = this.auth.magicLinkRetryAfterSeconds();
    if (retryAfterSeconds > 0) {
      return this.flash(
        `Ya solicitaste un enlace. Podrás solicitar otro en ${retryAfterSeconds} segundos.`,
        "error",
      );
    }
    await this.withLoading("login", async () => {
      try {
        await this.auth.sendMagicLink(normalizedEmail);
        this.flash(
          "Te enviamos un enlace de acceso. Revisa tu bandeja de entrada y el correo no deseado.",
        );
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async logout() {
    await this.withLoading("logout", async () => {
      try {
        await this.auth.signOut();
        this.items.set([]);
        this.batches.set([]);
        this.selected.set(null);
        this.selectedBatch.set(null);
        this.musicTracks.set([]);
        this.initialized = false;
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async load() {
    await this.withLoading("load", async () => {
      this.loading.set(true);
      try {
        const [rows, batches] = await Promise.all([
          this.api.list(),
          this.api.listBatches(),
        ]);
        this.items.set(rows);
        this.batches.set(batches);
        this.syncSelections(rows, batches);
      } catch (error) {
        this.flash(this.errorText(error), "error");
      } finally {
        this.loading.set(false);
      }
    });
  }

  async loadIntegrations() {
    try {
      const [music, tiktok] = await Promise.all([
        this.integrations.music(),
        this.integrations.tiktokStatus(),
      ]);
      this.musicTracks.set(music);
      this.tiktok.set(tiktok);
      if (!this.musicTrackId && music.length) this.musicTrackId = music[0].id;
    } catch (error) {
      this.flash(this.errorText(error), "error");
    }
  }

  async generate() {
    await this.withLoading("generate", async () => {
      try {
        let batch = await this.api.generate({
          name: this.batchName.trim() || undefined,
          brandName: this.brandName.trim() || "IMPULSO IA",
          theme: this.theme,
          tone: this.tone,
          count: this.count,
        });
        this.generationProgress.set({ current: 0, total: this.count });
        this.batches.update((rows) => [batch, ...rows]);
        this.selectedBatch.set(batch);

        for (let current = 1; current <= this.count; current++) {
          const result = await this.api.generateNext(batch.id);
          batch = result.batch;
          this.generationProgress.set({ current, total: this.count });
          this.batches.update((rows) => [
            batch,
            ...rows.filter((row) => row.id !== batch.id),
          ]);
          this.selectedBatch.set(batch);
          this.items.update((rows) => [result.publication, ...rows]);
          this.selected.set(result.publication);
        }

        this.generationProgress.set(null);
        await this.load();
        this.selectedBatch.set(
          this.batches().find((item) => item.id === batch.id) ?? batch,
        );
        this.filter.set("pending_review");
        this.flash(
          "La IA creó las imágenes del paquete. Revisa cada publicación.",
        );
      } catch (error) {
        this.generationProgress.set(null);
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async act(action: "approve" | "reject" | "regenerate") {
    const item = this.selected();
    if (!item) return;
    await this.withLoading(action, async () => {
      try {
        await this.api[action](item.id);
        await this.load();
        this.selected.set(
          action === "regenerate"
            ? this.items().find((row) => row.supersedesId === item.id) ??
                this.items().find((row) => row.id === item.id) ??
                null
            : this.items().find((row) => row.id === item.id) ?? null,
        );
        this.flash(
          action === "approve"
            ? "Contenido aprobado."
            : action === "reject"
              ? "Contenido rechazado."
              : "Nueva versión generada.",
        );
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  chooseMusicFile(event: Event) {
    this.musicFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  async uploadMusic() {
    if (!this.musicFile || !this.musicName.trim() || !this.musicLicense.trim()) {
      return this.flash(
        "Completa nombre, archivo y licencia de la pista.",
        "error",
      );
    }
    await this.withLoading("musicUpload", async () => {
      try {
        const form = new FormData();
        form.append("file", this.musicFile!);
        form.append("name", this.musicName.trim());
        form.append("licenseNotes", this.musicLicense.trim());
        form.append("source", this.musicSource);
        if (this.musicSource === "ai_generated") {
          form.append("aiProvider", this.musicAiProvider.trim());
        }
        await this.integrations.uploadMusic(form);
        this.musicFile = null;
        this.musicName = "";
        this.musicLicense = "";
        await this.loadIntegrations();
        this.flash("Pista verificada y guardada.");
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async connectTikTok() {
    await this.withLoading("tiktok", async () => {
      try {
        await this.integrations.connectTikTok();
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async disconnectTikTok() {
    await this.withLoading("tiktok", async () => {
      try {
        await this.integrations.disconnectTikTok();
        await this.loadIntegrations();
        this.flash("Cuenta TikTok desconectada.");
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async schedule() {
    const item = this.selected();
    if (!item || !this.scheduledFor || !this.musicTrackId) {
      return this.flash("Selecciona fecha, hora y música.", "error");
    }
    await this.withLoading("schedule", async () => {
      try {
        await this.api.schedule(item.id, {
          scheduledFor: new Date(this.scheduledFor).toISOString(),
          musicTrackId: this.musicTrackId,
        });
        await this.load();
        this.flash("Publicación programada.");
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async retryPublication() {
    const item = this.selected();
    if (!item || item.status !== "failed") return;
    await this.withLoading("retry", async () => {
      try {
        await this.api.retry(item.id);
        this.filter.set("scheduled");
        await this.load();
        this.selected.set(this.items().find((row) => row.id === item.id) ?? null);
        this.flash("Reintento programado. El publicador lo procesará en unos segundos.");
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  async approveSelectedBatch() {
    const batch = this.selectedBatch();
    if (!batch) return;
    await this.withLoading("approveBatch", async () => {
      try {
        await this.api.approveBatch(batch.id);
        await this.load();
        this.selectedBatch.set(
          this.batches().find((item) => item.id === batch.id) ?? null,
        );
        this.flash("Paquete aprobado. Ya puedes programar sus publicaciones.");
      } catch (error) {
        this.flash(this.errorText(error), "error");
      }
    });
  }

  select(item: Publication) {
    this.selected.set(item);
  }

  selectBatch(batch: PublicationBatch) {
    this.selectedBatch.set(batch);
  }

  statusLabel(status: PublicationStatus) {
    return (
      {
        generating: "Generando",
        pending_review: "Por revisar",
        approved: "Aprobada",
        scheduled: "Programada",
        publishing: "Publicando",
        published: "Publicada",
        rejected: "Rechazada",
        obsolete: "Obsoleta",
        failed: "Con error",
      } as Record<string, string>
    )[status];
  }

  batchStatusLabel(status: PublicationBatchStatus) {
    return (
      {
        generating: "Generando",
        pending_review: "Por revisar",
        approved: "Aprobado",
        scheduled: "Programado",
        published: "Publicado",
        failed: "Con error",
      } as Record<string, string>
    )[status];
  }

  imageStyle(item: Publication) {
    return item.composedImageUrl
      ? `linear-gradient(180deg,transparent 60%,#08110dc7),url("${item.composedImageUrl}")`
      : "linear-gradient(145deg,#dca76f,#478187,#183c31)";
  }

  async openPublication(item: Publication) {
    this.selected.set(item);
    this.filter.set(item.status);
    await this.router.navigate(["/publications"]);
  }

  private syncSelections(rows: Publication[], batches: PublicationBatch[]) {
    const selectedId = this.selected()?.id;
    const selectedBatchId = this.selectedBatch()?.id;
    this.selected.set(
      (selectedId ? rows.find((row) => row.id === selectedId) : undefined) ??
        rows[0] ??
        null,
    );
    this.selectedBatch.set(
      (selectedBatchId
        ? batches.find((row) => row.id === selectedBatchId)
        : undefined) ??
        batches[0] ??
        null,
    );
  }

  private async consumeTikTokCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error_description");
    if (!code && !error) return;

    await this.router.navigate(["/settings/tiktok"], { replaceUrl: true });
    if (error) {
      return this.flash(`TikTok rechazó la conexión: ${error}`, "error");
    }
    if (!state) {
      return this.flash(
        "TikTok no devolvió un estado de seguridad válido.",
        "error",
      );
    }
    try {
      await this.integrations.exchangeTikTokCode(code!, state);
      this.flash("Cuenta TikTok conectada correctamente.");
    } catch (failure) {
      this.flash(this.errorText(failure), "error");
    }
  }

  private async withLoading<T>(
    action: AsyncAction,
    operation: () => Promise<T>,
  ) {
    if (this.isLoading(action)) return;
    this.pendingActions.update((current) => new Set([...current, action]));
    try {
      return await operation();
    } finally {
      this.pendingActions.update((current) => {
        const next = new Set(current);
        next.delete(action);
        return next;
      });
    }
  }

  private flash(text: string, kind: MessageKind = "success") {
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageKind.set(kind);
    this.message.set(text);
    this.messageTimer = setTimeout(() => this.message.set(""), 5500);
  }

  private errorText(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      const apiMessage =
        error.error &&
        typeof error.error === "object" &&
        typeof error.error.message === "string"
          ? error.error.message
          : null;
      const apiCode =
        error.error &&
        typeof error.error === "object" &&
        typeof error.error.code === "string"
          ? error.error.code
          : null;
      const safeAuthCodes = new Set([
        "AUTH_EMAIL_DELIVERY_FAILED",
        "AUTH_MAGIC_LINK_FAILED",
        "AUTH_RATE_LIMIT_UNAVAILABLE",
      ]);
      if (apiMessage && (error.status < 500 || (apiCode && safeAuthCodes.has(apiCode)))) {
        return apiMessage;
      }
      if (error.status === 0) {
        return "No pudimos conectar con el servidor. Verifica tu conexión e inténtalo nuevamente.";
      }
      if (error.status === 401) {
        return "Tu sesión venció. Ingresa nuevamente para continuar.";
      }
      if (error.status >= 500) {
        return "El servicio no está disponible en este momento. Inténtalo nuevamente en unos minutos.";
      }
    }
    return "No pudimos completar la operación. Inténtalo nuevamente.";
  }
}
