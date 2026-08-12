import { Module } from "@nestjs/common";
import { TikTokModule } from "../tiktok/tiktok.module.js";
import { MediaComposerService } from "./media-composer.service.js";
import { PublisherService } from "./publisher.service.js";

@Module({
  imports: [TikTokModule],
  providers: [PublisherService, MediaComposerService],
  exports: [MediaComposerService],
})
export class PublisherModule {}
