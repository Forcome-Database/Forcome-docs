import { Injectable, Logger } from '@nestjs/common';
import { AiTemplateRepo } from '@docmost/db/repos/ai-template/ai-template.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { AI_TEMPLATES } from '../constants/ai-templates';
import { AiPromptTemplate } from '@docmost/db/types/entity.types';

export interface ResolvedTemplate {
  id?: string;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  prompt: string;
  scope: 'system' | 'workspace' | 'user';
  source: 'system' | 'workspace' | 'user';
  isDefault: boolean;
  canReset: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

@Injectable()
export class AiTemplateService {
  private readonly logger = new Logger(AiTemplateService.name);

  constructor(
    private readonly aiTemplateRepo: AiTemplateRepo,
    private readonly workspaceRepo: WorkspaceRepo,
  ) {}

  /**
   * Ensure workspace has seed templates from system defaults.
   * Called lazily on first template access.
   */
  async ensureSeedTemplates(
    workspaceId: string,
    creatorId: string,
  ): Promise<void> {
    const count = await this.aiTemplateRepo.countWorkspaceTemplates(workspaceId);

    if (count === 0) {
      // First time: insert all seed templates
      this.logger.log(`Seeding default templates for workspace ${workspaceId}`);
      const seeds = Object.values(AI_TEMPLATES).map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        icon: t.icon,
        prompt: t.prompt,
        scope: 'workspace' as const,
        workspaceId,
        creatorId,
        isDefault: true,
      }));
      await this.aiTemplateRepo.insertMany(seeds);
      return;
    }

    // Backfill: update existing default templates missing description/icon
    const existing = await this.aiTemplateRepo.findWorkspaceTemplates(workspaceId);
    for (const tmpl of existing) {
      if (!tmpl.isDefault) continue;
      const sys = AI_TEMPLATES[tmpl.key];
      if (!sys) continue;
      if (!tmpl.description || !tmpl.icon) {
        await this.aiTemplateRepo.updateTemplate(
          {
            ...((!tmpl.description && sys.description) ? { description: sys.description } : {}),
            ...((!tmpl.icon && sys.icon) ? { icon: sys.icon } : {}),
          },
          tmpl.id,
        );
      }
    }
  }

  /**
   * Three-layer resolution: system defaults → workspace templates → user templates.
   * Returns merged list sorted by key.
   */
  async getResolvedTemplates(
    workspaceId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<ResolvedTemplate[]> {
    const resolved = new Map<string, ResolvedTemplate>();

    // Layer 1: System defaults (always available as fallback)
    for (const t of Object.values(AI_TEMPLATES)) {
      resolved.set(t.key, {
        key: t.key,
        name: t.name,
        description: t.description,
        icon: t.icon,
        prompt: t.prompt,
        scope: 'system',
        source: 'system',
        isDefault: true,
        canReset: false,
        canEdit: false,   // system defaults are never directly editable
        canDelete: false,
      });
    }

    // Layer 2: Workspace templates (override system defaults)
    const workspaceTemplates =
      await this.aiTemplateRepo.findWorkspaceTemplates(workspaceId);
    for (const t of workspaceTemplates) {
      const prev = resolved.get(t.key);
      resolved.set(t.key, {
        id: t.id,
        key: t.key,
        name: t.name,
        description: t.description ?? prev?.description,
        icon: t.icon ?? prev?.icon,
        prompt: t.prompt,
        scope: 'workspace',
        source: 'workspace',
        isDefault: t.isDefault,
        canReset: false,
        canEdit: isAdmin,     // only admin can edit workspace templates
        canDelete: isAdmin && !t.isDefault, // admin can delete non-default workspace templates
      });
    }

    // Layer 3: User templates (override workspace templates)
    const userTemplates =
      await this.aiTemplateRepo.findUserTemplates(workspaceId, userId);
    for (const t of userTemplates) {
      const existsBelow = resolved.has(t.key);
      const prev = resolved.get(t.key);
      resolved.set(t.key, {
        id: t.id,
        key: t.key,
        name: t.name,
        description: t.description ?? prev?.description,
        icon: t.icon ?? prev?.icon,
        prompt: t.prompt,
        scope: 'user',
        source: 'user',
        isDefault: false,
        canReset: existsBelow,
        canEdit: true,    // user always can edit their own templates
        canDelete: true,  // user always can delete their own templates
      });
    }

    return Array.from(resolved.values());
  }

  /**
   * Get the effective prompt for a template key, resolving through all layers.
   */
  async getTemplatePrompt(
    key: string,
    workspaceId: string,
    userId: string,
  ): Promise<string | null> {
    // Try user-level first
    const userTemplate = await this.aiTemplateRepo.findByKey(
      workspaceId,
      key,
      'user',
      userId,
    );
    if (userTemplate) return userTemplate.prompt;

    // Try workspace-level
    const wsTemplate = await this.aiTemplateRepo.findByKey(
      workspaceId,
      key,
      'workspace',
    );
    if (wsTemplate) return wsTemplate.prompt;

    // Fallback to system default
    const systemTemplate = AI_TEMPLATES[key];
    return systemTemplate?.prompt ?? null;
  }

  /**
   * Get the global system prompt from workspace settings.
   */
  async getSystemPrompt(workspaceId: string): Promise<string> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    const settings = workspace?.settings as any;
    return settings?.ai?.systemPrompt || '';
  }

  /**
   * Update the global system prompt in workspace settings.
   */
  async updateSystemPrompt(
    workspaceId: string,
    systemPrompt: string,
  ): Promise<void> {
    await this.workspaceRepo.updateAiSettings(
      workspaceId,
      'systemPrompt',
      systemPrompt,
    );
  }

  /**
   * Create a new template.
   */
  async createTemplate(
    data: {
      key: string;
      name: string;
      description?: string;
      icon?: string;
      prompt: string;
      scope: 'workspace' | 'user';
    },
    workspaceId: string,
    creatorId: string,
  ): Promise<AiPromptTemplate> {
    return this.aiTemplateRepo.insertTemplate({
      key: data.key,
      name: data.name,
      description: data.description || null,
      icon: data.icon || null,
      prompt: data.prompt,
      scope: data.scope,
      workspaceId,
      creatorId,
      isDefault: false,
    });
  }

  /**
   * Update an existing template.
   */
  async updateTemplate(
    id: string,
    data: {
      name?: string;
      description?: string;
      icon?: string;
      prompt?: string;
    },
  ): Promise<AiPromptTemplate> {
    return this.aiTemplateRepo.updateTemplate(
      {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.icon !== undefined && { icon: data.icon }),
        ...(data.prompt !== undefined && { prompt: data.prompt }),
      },
      id,
    );
  }

  /**
   * Soft-delete a template.
   */
  async deleteTemplate(id: string): Promise<void> {
    await this.aiTemplateRepo.softDelete(id);
  }

  /**
   * Reset a user's override for a specific template key
   * (removes the user-level template so the workspace/system default shows through).
   */
  async resetUserTemplate(
    workspaceId: string,
    userId: string,
    key: string,
  ): Promise<void> {
    await this.aiTemplateRepo.softDeleteByKey(
      workspaceId,
      key,
      'user',
      userId,
    );
  }

  /**
   * Get a template by ID (for ownership checks).
   */
  async getTemplateById(id: string): Promise<AiPromptTemplate | undefined> {
    return this.aiTemplateRepo.findById(id);
  }
}
