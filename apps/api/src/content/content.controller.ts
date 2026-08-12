import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { ContentService } from './content.service.js';
import { GenerateBatchDto, ListQueryDto, ScheduleDto } from './dto.js';

@Controller('publications')
export class ContentController {
  constructor(private readonly content: ContentService) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Query() query: ListQueryDto) { return this.content.list(req.user.id, query.status); }
  @Post('generate') generate(@Req() req: AuthenticatedRequest, @Body() dto: GenerateBatchDto) { return this.content.generateBatch(req.user.id, dto); }
  @Patch(':id/approve') approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.content.approve(req.user.id, id); }
  @Patch(':id/reject') reject(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.content.reject(req.user.id, id); }
  @Post(':id/regenerate') regenerate(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.content.regenerate(req.user.id, id); }
  @Patch(':id/schedule') schedule(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ScheduleDto) { return this.content.schedule(req.user.id, id, dto); }
}
