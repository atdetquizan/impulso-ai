import { Module } from "@nestjs/common";
import { MusicController } from "./music.controller.js";
import { MusicService } from "./music.service.js";

@Module({ controllers: [MusicController], providers: [MusicService], exports: [MusicService] })
export class MusicModule {}
