import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  CreateApiKeyDto,
  UpdateApiKeyDto,
  RevokeApiKeyDto,
} from './dto/api-key.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';

@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post()
  async list(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: PaginationOptions,
  ) {
    return this.apiKeyService.listApiKeys(workspace.id, dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeyService.createApiKey(dto, user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.apiKeyService.updateApiKey(dto, user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('revoke')
  async revoke(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: RevokeApiKeyDto,
  ) {
    return this.apiKeyService.revokeApiKey(dto.apiKeyId, user.id, workspace.id);
  }
}
