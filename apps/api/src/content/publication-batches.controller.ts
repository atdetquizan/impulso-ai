import { Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { ContentService } from "./content.service.js";

@Controller("publication-batches")
export class PublicationBatchesController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.content.listBatches(req.user.id);
  }

  @Get(":id")
  find(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.content.findBatch(req.user.id, id);
  }

  @Patch(":id/approve")
  approve(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.content.approveBatch(req.user.id, id);
  }

  @Post(":id/generate-next")
  generateNext(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.content.generateNext(req.user.id, id);
  }
}
