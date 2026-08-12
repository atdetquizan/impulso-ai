import type { GeneratedConcept } from "@impulso/contracts";

export const CONTENT_AI_PROVIDER = Symbol("CONTENT_AI_PROVIDER");

export interface ContentAiProvider {
  readonly providerName: "cloudflare" | "openai";
  readonly textModel: string;
  readonly imageModel: string;

  generateConcept(
    theme: string,
    tone: string,
    avoid: string[],
  ): Promise<GeneratedConcept>;
  generateImage(prompt: string): Promise<Buffer>;
}
