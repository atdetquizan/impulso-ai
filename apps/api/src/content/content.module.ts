import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ContentController } from "./content.controller.js";
import { ContentService } from "./content.service.js";
import { CloudflareContentService } from "./cloudflare-content.service.js";
import {
  CONTENT_AI_PROVIDER,
  type ContentAiProvider,
} from "./content-ai.provider.js";
import { OpenAiContentService } from "./openai-content.service.js";
import { PublisherModule } from "../publisher/publisher.module.js";
import { PublicationBatchesController } from "./publication-batches.controller.js";

@Module({
  imports: [PublisherModule],
  controllers: [ContentController, PublicationBatchesController],
  providers: [
    ContentService,
    {
      provide: CONTENT_AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ContentAiProvider => {
        const provider = (
          config.get<string>("AI_PROVIDER") ?? "cloudflare"
        ).toLowerCase();
        if (provider === "cloudflare")
          return new CloudflareContentService(config);
        if (provider === "openai") return new OpenAiContentService(config);
        throw new Error(
          `AI_PROVIDER no soportado: ${provider}. Usa cloudflare u openai.`,
        );
      },
    },
  ],
  exports: [ContentService],
})
export class ContentModule {}
