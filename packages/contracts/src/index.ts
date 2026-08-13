export const publicationStatuses = [
  "generating",
  "pending_review",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "rejected",
  "obsolete",
  "failed",
] as const;

export type PublicationStatus = (typeof publicationStatuses)[number];

export const publicationBatchStatuses = [
  "generating",
  "pending_review",
  "approved",
  "scheduled",
  "published",
  "failed",
] as const;

export type PublicationBatchStatus = (typeof publicationBatchStatuses)[number];

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface MagicLinkRequest {
  email: string;
}

export interface MagicLinkResponse {
  sent: true;
  retryAfterSeconds: number;
}

export interface CreateSessionRequest {
  token: string;
}

export interface Publication {
  id: string;
  batchId: string | null;
  userId: string;
  theme: string;
  tone: string;
  quote: string;
  caption: string;
  hashtags: string[];
  imagePrompt: string;
  imagePath: string | null;
  backgroundImagePath: string | null;
  composedImagePath: string | null;
  backgroundImageUrl: string | null;
  composedImageUrl: string | null;
  templateId: string;
  brandName: string;
  videoPath: string | null;
  musicTrackId: string | null;
  status: PublicationStatus;
  scheduledFor: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  externalPostId: string | null;
  errorMessage: string | null;
  version: number;
  isCurrent: boolean;
  supersedesId: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationBatch {
  id: string;
  userId: string;
  name: string;
  theme: string;
  tone: string;
  brandName: string;
  requestedCount: number;
  generatedCount: number;
  obsoleteCount: number;
  status: PublicationBatchStatus;
  publications: Publication[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerateBatchRequest {
  name?: string;
  brandName: string;
  theme: string;
  tone: "cercano" | "energico" | "reflexivo";
  count: 2 | 3;
  targetDates?: string[];
}

export interface SchedulePublicationRequest {
  scheduledFor: string;
  musicTrackId: string;
}

export interface GeneratedConcept {
  quote: string;
  caption: string;
  hashtags: string[];
  imagePrompt: string;
}

export interface MusicTrack {
  id: string;
  name: string;
  durationSeconds: number;
  licenseNotes: string | null;
  source: "uploaded" | "ai_generated";
  aiProvider: string | null;
  validationStatus: "verified" | "invalid" | "pending";
  previewUrl: string | null;
  active: boolean;
}

export interface TikTokConnectionStatus {
  configured: boolean;
  connected: boolean;
  pkceRequired?: boolean;
  displayName?: string | null;
  expiresAt?: string | null;
  scopes?: string[];
}
