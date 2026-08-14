import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { GeneratedConcept } from "@impulso/contracts";
import OpenAI from "openai";
import type { ContentAiProvider } from "./content-ai.provider.js";

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareImageResult {
  image?: string;
}

const conceptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quote", "caption", "hashtags", "imagePrompt"],
  properties: {
    quote: { type: "string", minLength: 25, maxLength: 150 },
    caption: { type: "string", minLength: 30, maxLength: 400 },
    hashtags: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: { type: "string" },
    },
    imagePrompt: { type: "string", minLength: 40, maxLength: 600 },
  },
} as const;

export class CloudflareContentService implements ContentAiProvider {
  private readonly logger = new Logger(CloudflareContentService.name);
  readonly providerName = "cloudflare" as const;
  readonly textModel: string;
  readonly imageModel: string;

  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly imageSteps: number;
  private readonly textClient: OpenAI;
  private readonly textMaxCompletionTokens: number;
  private readonly reasoningEffort: "low" | "medium" | "high";

  constructor(config: ConfigService) {
    this.accountId = config.getOrThrow<string>("CLOUDFLARE_ACCOUNT_ID");
    this.apiToken = config.getOrThrow<string>("CLOUDFLARE_API_TOKEN");
    this.textModel =
      config.get<string>("CLOUDFLARE_TEXT_MODEL") ??
      "@cf/google/gemma-4-26b-a4b-it";
    this.imageModel =
      config.get<string>("CLOUDFLARE_IMAGE_MODEL") ??
      "@cf/black-forest-labs/flux-1-schnell";
    this.baseUrl =
      config.get<string>("CLOUDFLARE_AI_BASE_URL") ??
      "https://api.cloudflare.com/client/v4";
    this.textClient = new OpenAI({
      apiKey: this.apiToken,
      baseURL: `${this.baseUrl.replace(/\/$/, "")}/accounts/${encodeURIComponent(this.accountId)}/ai/v1`,
    });
    const configuredTextTokens = Number(
      config.get<string>("CLOUDFLARE_TEXT_MAX_COMPLETION_TOKENS") ?? "2400",
    );
    this.textMaxCompletionTokens = Number.isFinite(configuredTextTokens)
      ? Math.min(4000, Math.max(800, Math.floor(configuredTextTokens)))
      : 2400;
    const configuredEffort =
      config.get<string>("CLOUDFLARE_REASONING_EFFORT") ?? "low";
    this.reasoningEffort = ["low", "medium", "high"].includes(configuredEffort)
      ? (configuredEffort as "low" | "medium" | "high")
      : "low";
    const configuredSteps = Number(
      config.get<string>("CLOUDFLARE_IMAGE_STEPS") ?? "4",
    );
    this.imageSteps = Number.isFinite(configuredSteps)
      ? Math.min(8, Math.max(1, configuredSteps))
      : 4;
  }

  async generateConcept(
    theme: string,
    tone: string,
    avoid: string[],
  ): Promise<GeneratedConcept> {
    let content: string | null | undefined;
    let diagnostics: Record<string, unknown> = {
      provider: this.providerName,
      model: this.textModel,
    };
    try {
      const completion = await this.textClient.chat.completions.create({
        model: this.textModel,
        messages: [
          {
            role: "system",
            content: [
              "Eres editor de contenido motivacional en español latino para TikTok.",
              "Crea contenido original, concreto y natural. No atribuyas frases a autores.",
              "No hagas promesas médicas, financieras ni absolutas.",
              "Responde solamente con un objeto JSON válido, sin Markdown ni explicaciones.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Tema: ${theme}.`,
              `Tono: ${tone}.`,
              `Evita repetir: ${avoid.join(" | ") || "ninguna"}.`,
              'Devuelve exactamente: {"quote":"...","caption":"...","hashtags":["#..."],"imagePrompt":"..."}.',
              "quote: 25 a 150 caracteres. caption: 30 a 400 caracteres.",
              "hashtags: entre 3 y 6. imagePrompt: 40 a 600 caracteres, preferiblemente en inglés.",
              "La imagen debe ser cinematográfica, sin texto, marcas ni logotipos y permitir recorte vertical 9:16.",
            ].join(" "),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "motivational_concept",
            strict: true,
            schema: conceptSchema,
          },
        },
        max_completion_tokens: this.textMaxCompletionTokens,
        reasoning_effort: this.reasoningEffort,
        temperature: 0.8,
      });
      diagnostics = this.completionDiagnostics(completion);
      content = this.completionContent(completion);
    } catch (error) {
      this.throwTextGenerationError(error);
    }

    if (!content) {
      this.logger.warn(
        `Cloudflare Chat Completions devolvió contenido vacío: ${JSON.stringify(diagnostics)}`,
      );
      throw new BadGatewayException({
        statusCode: HttpStatus.BAD_GATEWAY,
        code: "AI_EMPTY_COMPLETION",
        message:
          "Cloudflare Workers AI no devolvió contenido final. Revisa diagnostics y finishReason.",
        diagnostics,
      });
    }
    this.logger.debug(
      `Cloudflare Chat Completions completado: ${JSON.stringify(diagnostics)}`,
    );
    return this.parseConcept(content);
  }

  async generateImage(prompt: string): Promise<Buffer> {
    const imagePrompt = `${prompt}. Cinematic composition suitable for a 9:16 vertical crop. Keep a clean central area for a motivational quote overlay. No letters, words, logos or watermarks.`;
    const result = await this.runModel<CloudflareImageResult>(
      this.imageModel,
      this.imageInput(imagePrompt),
    );

    if (!result.image) {
      throw new BadGatewayException(
        "Cloudflare Workers AI no devolvió los bytes de la imagen.",
      );
    }
    return Buffer.from(result.image, "base64");
  }

  private imageInput(prompt: string): Record<string, unknown> {
    const input: Record<string, unknown> = { prompt };
    if (this.imageModel === "@cf/black-forest-labs/flux-1-schnell") {
      input.steps = this.imageSteps;
    }
    return input;
  }

  private async runModel<T>(
    model: string,
    input: Record<string, unknown>,
  ): Promise<T> {
    const endpoint = `${this.baseUrl}/accounts/${encodeURIComponent(this.accountId)}/ai/run/${model}`;
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Error de red";
      throw new BadGatewayException(
        `No se pudo conectar con Cloudflare Workers AI: ${detail}`,
      );
    }

    const payload = (await response
      .json()
      .catch(() => ({}))) as CloudflareEnvelope<T>;
    if (
      !response.ok ||
      payload.success === false ||
      payload.result === undefined
    ) {
      const detail = payload.errors
        ?.map((item) => item.message)
        .filter(Boolean)
        .join("; ");
      const diagnostics = {
        provider: this.providerName,
        model,
        httpStatus: response.status,
      };
      this.logger.error(
        `Cloudflare Workers AI rechazó la imagen: ${JSON.stringify({ ...diagnostics, detail: detail || null })}`,
      );
      if (response.status === 429) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            code: "AI_RATE_LIMIT",
            message:
              "Se alcanzó temporalmente el límite de generación de imágenes. Intenta nuevamente en unos minutos.",
            diagnostics,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new BadGatewayException({
          statusCode: HttpStatus.BAD_GATEWAY,
          code: "AI_AUTH_ERROR",
          message:
            "No se pudo autorizar la generación de imágenes. Revisa la configuración de Cloudflare Workers AI.",
          diagnostics,
        });
      }
      if (
        response.status === 400 ||
        /bad input|additional|unevaluated properties|not allowed/i.test(detail ?? "")
      ) {
        throw new BadGatewayException({
          statusCode: HttpStatus.BAD_GATEWAY,
          code: "AI_IMAGE_BAD_INPUT",
          message:
            "El modelo de imágenes rechazó su configuración. Verifica que CLOUDFLARE_IMAGE_MODEL sea compatible con esta versión.",
          diagnostics,
        });
      }
      throw new BadGatewayException({
        statusCode: HttpStatus.BAD_GATEWAY,
        code: "AI_IMAGE_PROVIDER_ERROR",
        message:
          "No se pudo generar la imagen en este momento. Intenta regenerarla en unos minutos.",
        diagnostics,
      });
    }
    return payload.result;
  }

  private throwTextGenerationError(error: unknown): never {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
    const detail = error instanceof Error ? error.message : "Error desconocido";
    const diagnostics = this.providerErrorDiagnostics(error);
    this.logger.error(
      `Cloudflare Chat Completions rechazó la solicitud: ${JSON.stringify(diagnostics)}`,
    );

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: "AI_RATE_LIMIT",
          message: `Cloudflare Workers AI alcanzó su límite temporal: ${detail}`,
          diagnostics,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      throw new BadGatewayException({
        statusCode: HttpStatus.BAD_GATEWAY,
        code: "AI_AUTH_ERROR",
        message:
          "Cloudflare rechazó las credenciales. Revisa CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN.",
        diagnostics,
      });
    }
    throw new BadGatewayException({
      statusCode: HttpStatus.BAD_GATEWAY,
      code: "AI_PROVIDER_ERROR",
      message: `Cloudflare Workers AI rechazó la generación del concepto: ${detail}`,
      diagnostics,
    });
  }

  private completionContent(completion: unknown): string | null {
    const payload = this.unwrapCompletion(completion);
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    const choice = this.asRecord(choices[0]);
    const message = this.asRecord(choice?.message);
    const content = message?.content;

    if (typeof content === "string") return content.trim() || null;
    if (!Array.isArray(content)) return null;

    const combined = content
      .map((part) => {
        if (typeof part === "string") return part;
        const record = this.asRecord(part);
        return typeof record?.text === "string" ? record.text : "";
      })
      .join("")
      .trim();
    return combined || null;
  }

  private completionDiagnostics(completion: unknown): Record<string, unknown> {
    const root = this.asRecord(completion);
    const payload = this.unwrapCompletion(completion);
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    const choice = this.asRecord(choices[0]);
    const message = this.asRecord(choice?.message);
    const content = message?.content;
    const reasoningContent = message?.reasoning_content ?? message?.reasoning;
    const usage = this.asRecord(payload?.usage);
    const completionDetails = this.asRecord(usage?.completion_tokens_details);

    return {
      provider: this.providerName,
      requestId:
        root?._request_id ?? payload?.request_id ?? payload?.id ?? null,
      model: payload?.model ?? this.textModel,
      object: payload?.object ?? null,
      envelopeDetected: root !== payload,
      rootKeys: root ? Object.keys(root).slice(0, 15) : [],
      payloadKeys: payload ? Object.keys(payload).slice(0, 15) : [],
      choicesCount: choices.length,
      finishReason: choice?.finish_reason ?? null,
      messageKeys: message ? Object.keys(message) : [],
      contentType:
        content === null
          ? "null"
          : Array.isArray(content)
            ? "array"
            : typeof content,
      contentLength: typeof content === "string" ? content.length : null,
      reasoningContentLength:
        typeof reasoningContent === "string" ? reasoningContent.length : null,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      reasoningTokens: completionDetails?.reasoning_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      configuredMaxCompletionTokens: this.textMaxCompletionTokens,
      configuredReasoningEffort: this.reasoningEffort,
    };
  }

  private unwrapCompletion(value: unknown): Record<string, unknown> | null {
    const root = this.asRecord(value);
    return this.asRecord(root?.result) ?? root;
  }

  private providerErrorDiagnostics(error: unknown): Record<string, unknown> {
    const record = this.asRecord(error);
    return {
      provider: this.providerName,
      model: this.textModel,
      requestId: record?.request_id ?? record?.requestID ?? null,
      status: record?.status ?? null,
      code: record?.code ?? null,
      type: record?.type ?? null,
      name: error instanceof Error ? error.name : null,
      configuredMaxCompletionTokens: this.textMaxCompletionTokens,
      configuredReasoningEffort: this.reasoningEffort,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  }

  private parseConcept(raw: unknown): GeneratedConcept {
    let value: unknown = raw;
    if (typeof raw === "string") {
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
      try {
        value = JSON.parse(cleaned);
      } catch {
        throw new BadGatewayException(
          "Cloudflare Workers AI devolvió una respuesta que no es JSON válido.",
        );
      }
    }

    if (!value || typeof value !== "object") {
      throw new BadGatewayException(
        "Cloudflare Workers AI devolvió un concepto incompleto.",
      );
    }
    const candidate = value as Record<string, unknown>;
    const quote =
      typeof candidate.quote === "string" ? candidate.quote.trim() : "";
    const caption =
      typeof candidate.caption === "string" ? candidate.caption.trim() : "";
    const imagePrompt =
      typeof candidate.imagePrompt === "string"
        ? candidate.imagePrompt.trim()
        : "";
    const hashtags = Array.isArray(candidate.hashtags)
      ? [
          ...new Set(
            candidate.hashtags
              .filter((item): item is string => typeof item === "string")
              .map((item) => {
                const hashtag = item.trim().replace(/\s+/g, "");
                return hashtag.startsWith("#") ? hashtag : `#${hashtag}`;
              })
              .filter((item) => item.length > 1),
          ),
        ].slice(0, 6)
      : [];

    if (
      quote.length < 25 ||
      quote.length > 150 ||
      caption.length < 30 ||
      caption.length > 400 ||
      imagePrompt.length < 40 ||
      imagePrompt.length > 600 ||
      hashtags.length < 3
    ) {
      throw new BadGatewayException(
        "Cloudflare Workers AI devolvió un concepto fuera del formato esperado. Regenera el contenido.",
      );
    }

    return { quote, caption, hashtags, imagePrompt };
  }
}
