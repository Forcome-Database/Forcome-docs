import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AiTemplateService } from './services/ai-template.service';
import WorkspaceAbilityFactory from '../../core/casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../core/casl/interfaces/workspace-ability.type';
import {
  CreateAiTemplateDto,
  UpdateAiTemplateDto,
  DeleteAiTemplateDto,
  ResetAiTemplateDto,
  UpdateAiSystemPromptDto,
  AiTemplateScope,
} from './dto/ai-template.dto';

@UseGuards(JwtAuthGuard)
@Controller('ai/templates')
export class AiTemplateController {
  constructor(
    private readonly aiTemplateService: AiTemplateService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('list')
  async listTemplates(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    // Ensure seed templates exist (lazy initialization)
    await this.aiTemplateService.ensureSeedTemplates(workspace.id, user.id);

    const isAdmin = this.isAdmin(user, workspace);
    const templates = await this.aiTemplateService.getResolvedTemplates(
      workspace.id,
      user.id,
      isAdmin,
    );
    return { templates };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createTemplate(
    @Body() dto: CreateAiTemplateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    // Workspace-scope templates require admin permission
    if (dto.scope === AiTemplateScope.WORKSPACE) {
      this.checkAdminPermission(user, workspace);
    }

    const template = await this.aiTemplateService.createTemplate(
      dto,
      workspace.id,
      user.id,
    );
    return { template };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateTemplate(
    @Body() dto: UpdateAiTemplateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const existing = await this.aiTemplateService.getTemplateById(
      dto.templateId,
    );
    if (!existing) {
      throw new ForbiddenException('Template not found');
    }

    // Check ownership: admin can edit workspace templates, user can edit own templates
    if (existing.scope === 'workspace') {
      this.checkAdminPermission(user, workspace);
    } else if (existing.creatorId !== user.id) {
      throw new ForbiddenException();
    }

    const template = await this.aiTemplateService.updateTemplate(
      dto.templateId,
      dto,
    );
    return { template };
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteTemplate(
    @Body() dto: DeleteAiTemplateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const existing = await this.aiTemplateService.getTemplateById(
      dto.templateId,
    );
    if (!existing) {
      throw new ForbiddenException('Template not found');
    }

    // Check ownership
    if (existing.scope === 'workspace') {
      this.checkAdminPermission(user, workspace);
    } else if (existing.creatorId !== user.id) {
      throw new ForbiddenException();
    }

    await this.aiTemplateService.deleteTemplate(dto.templateId);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('reset')
  async resetTemplate(
    @Body() dto: ResetAiTemplateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.aiTemplateService.resetUserTemplate(
      workspace.id,
      user.id,
      dto.key,
    );
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('system-prompt')
  async getSystemPrompt(@AuthWorkspace() workspace: Workspace) {
    const systemPrompt = await this.aiTemplateService.getSystemPrompt(
      workspace.id,
    );
    return { systemPrompt };
  }

  @HttpCode(HttpStatus.OK)
  @Post('system-prompt/update')
  async updateSystemPrompt(
    @Body() dto: UpdateAiSystemPromptDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.checkAdminPermission(user, workspace);

    await this.aiTemplateService.updateSystemPrompt(
      workspace.id,
      dto.systemPrompt,
    );
    return { success: true };
  }

  private isAdmin(user: User, workspace: Workspace): boolean {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    return ability.can(
      WorkspaceCaslAction.Manage,
      WorkspaceCaslSubject.Settings,
    );
  }

  private checkAdminPermission(user: User, workspace: Workspace) {
    if (!this.isAdmin(user, workspace)) {
      throw new ForbiddenException();
    }
  }
}
