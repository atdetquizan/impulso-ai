import { Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { MusicService } from "./music.service.js";

@Controller("music")
export class MusicController {
  constructor(private readonly music: MusicService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) { return this.music.list(req.user.id); }

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 30 * 1024 * 1024 } }))
  upload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined,
    @Body() body: Record<string, string | undefined>,
  ) { return this.music.upload(req.user.id, file, body); }

  @Patch(":id/disable")
  disable(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.music.disable(req.user.id, id); }
}
