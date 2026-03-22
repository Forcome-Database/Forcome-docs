import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { InlineRewriteService, type InlineRewriteRequest } from './inline-rewrite.service';

@Controller('ai/inline')
@UseGuards(JwtAuthGuard)
export class InlineRewriteController {
  constructor(private readonly inlineRewriteService: InlineRewriteService) {}

  @Post('rewrite')
  async rewriteSelection(@Body() body: InlineRewriteRequest) {
    return this.inlineRewriteService.rewriteSelection(body);
  }
}
