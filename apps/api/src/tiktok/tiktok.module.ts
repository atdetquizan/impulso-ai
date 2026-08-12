import { Module } from '@nestjs/common';
import { TikTokController } from './tiktok.controller.js';
import { TikTokService } from './tiktok.service.js';
import { TokenCryptoService } from './token-crypto.service.js';

@Module({ controllers: [TikTokController], providers: [TikTokService, TokenCryptoService], exports: [TikTokService] })
export class TikTokModule {}
