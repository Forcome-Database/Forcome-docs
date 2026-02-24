import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyRepo } from './api-key.repo';
import { TokenService } from '../../core/auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { JwtApiKeyPayload } from '../../core/auth/dto/jwt-payload';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
  ) {}

  async validateApiKey(
    payload: JwtApiKeyPayload,
  ): Promise<{ user: User; workspace: Workspace }> {
    const apiKey = await this.apiKeyRepo.findById(
      payload.apiKeyId,
      payload.workspaceId,
    );

    if (!apiKey || apiKey.deletedAt) {
      throw new UnauthorizedException('API key not found or revoked');
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    await this.apiKeyRepo.updateLastUsedAt(apiKey.id);

    const user = await this.userRepo.findById(
      payload.sub,
      payload.workspaceId,
    );

    if (!user || user.deactivatedAt || user.deletedAt) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    const workspace = await this.workspaceRepo.findById(payload.workspaceId);

    if (!workspace) {
      throw new UnauthorizedException('Workspace not found');
    }

    return { user, workspace };
  }

  async createApiKey(dto: CreateApiKeyDto, userId: string, workspaceId: string) {
    const user = await this.userRepo.findById(userId, workspaceId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    const apiKey = await this.apiKeyRepo.insertApiKey({
      name: dto.name,
      creatorId: userId,
      workspaceId,
      expiresAt,
    });

    let expiresIn: number | undefined;
    if (expiresAt) {
      expiresIn = expiresAt.getTime() - Date.now();
      if (expiresIn <= 0) {
        expiresIn = undefined;
      }
    }

    const token = await this.tokenService.generateApiToken({
      apiKeyId: apiKey.id,
      user,
      workspaceId,
      expiresIn,
    });

    return { ...apiKey, token };
  }

  async listApiKeys(
    workspaceId: string,
    pagination: PaginationOptions,
    userId: string,
  ) {
    if (pagination.adminView) {
      return this.apiKeyRepo.findByWorkspaceId(workspaceId, pagination);
    }
    return this.apiKeyRepo.findByCreatorId(userId, workspaceId, pagination);
  }

  async updateApiKey(
    dto: UpdateApiKeyDto,
    userId: string,
    workspaceId: string,
  ) {
    const apiKey = await this.apiKeyRepo.findById(dto.apiKeyId, workspaceId);

    if (!apiKey || apiKey.deletedAt) {
      throw new NotFoundException('API key not found');
    }

    return this.apiKeyRepo.updateApiKey(dto.apiKeyId, workspaceId, {
      name: dto.name,
    });
  }

  async revokeApiKey(apiKeyId: string, userId: string, workspaceId: string) {
    const apiKey = await this.apiKeyRepo.findById(apiKeyId, workspaceId);

    if (!apiKey || apiKey.deletedAt) {
      throw new NotFoundException('API key not found');
    }

    await this.apiKeyRepo.softDelete(apiKeyId, workspaceId);
  }
}
