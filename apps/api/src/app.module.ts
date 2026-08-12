import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { ContentModule } from './content/content.module.js';
import { TikTokModule } from './tiktok/tiktok.module.js';
import { PublisherModule } from './publisher/publisher.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MusicModule } from './music/music.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    SupabaseModule,
    AuthModule,
    ContentModule,
    TikTokModule,
    PublisherModule,
    MusicModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
