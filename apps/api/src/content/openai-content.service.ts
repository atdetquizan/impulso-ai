import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { GeneratedConcept } from '@impulso/contracts';
import type { ContentAiProvider } from './content-ai.provider.js';

const conceptSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['quote', 'caption', 'hashtags', 'imagePrompt'],
  properties: {
    quote: { type: 'string', minLength: 25, maxLength: 150 },
    caption: { type: 'string', minLength: 30, maxLength: 400 },
    hashtags: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
    imagePrompt: { type: 'string', minLength: 40, maxLength: 600 },
  },
} as const;

@Injectable()
export class OpenAiContentService implements ContentAiProvider {
  readonly providerName = 'openai' as const;
  private readonly client: OpenAI;
  readonly textModel: string;
  readonly imageModel: string;

  constructor(config: ConfigService) {
    this.client = new OpenAI({ apiKey: config.getOrThrow<string>('OPENAI_API_KEY') });
    this.textModel = config.get<string>('OPENAI_TEXT_MODEL') ?? 'gpt-5.6';
    this.imageModel = config.get<string>('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2';
  }

  async generateConcept(theme: string, tone: string, avoid: string[]): Promise<GeneratedConcept> {
    const response = await this.client.responses.create({
      model: this.textModel,
      store: false,
      instructions: 'Eres editor de contenido motivacional en español latino para TikTok. Crea contenido original, concreto, natural y sin atribuir frases a autores. No hagas promesas médicas, financieras ni absolutas.',
      input: `Tema: ${theme}. Tono: ${tone}. Evita repetir estas frases: ${avoid.join(' | ') || 'ninguna'}. La imagen debe ser vertical 9:16, cinematográfica, sin texto, marcas ni logotipos.`,
      text: {
        format: {
          type: 'json_schema',
          name: 'motivational_concept',
          strict: true,
          schema: conceptSchema,
        },
      },
    });
    return JSON.parse(response.output_text) as GeneratedConcept;
  }

  async generateImage(prompt: string): Promise<Buffer> {
    const result = await this.client.images.generate({
      model: this.imageModel,
      prompt: `${prompt}. Composición vertical 9:16, reserva espacio visual limpio en el centro para superponer una frase después. Sin letras ni texto.`,
      size: '1024x1536',
      quality: 'medium',
      output_format: 'png',
    });
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) throw new Error('OpenAI returned no image bytes');
    return Buffer.from(encoded, 'base64');
  }
}
