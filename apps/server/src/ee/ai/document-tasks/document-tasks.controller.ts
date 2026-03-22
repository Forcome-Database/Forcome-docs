import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { DocumentTasksService } from './document-tasks.service';

type MultipartLikePart =
  | {
      type: 'file';
      mimetype: string;
      filename: string;
      toBuffer: () => Promise<Buffer>;
    }
  | {
      type: 'field';
      fieldname: string;
      value: unknown;
    };

type CreateTaskFields = {
  prompt?: string;
  pageId?: string;
  pageTitle?: string;
  pageContent?: string;
  taskType?: string;
  sourceScope?: string;
  mode?: string;
};

function isMultipartContentType(req: FastifyRequest): boolean {
  const contentType = req.headers['content-type'];
  if (Array.isArray(contentType)) {
    return contentType.some((value) => value.includes('multipart/form-data'));
  }

  return typeof contentType === 'string' && contentType.includes('multipart/form-data');
}

@Controller('ai/document-tasks')
@UseGuards(JwtAuthGuard)
export class DocumentTasksController {
  constructor(private readonly documentTasksService: DocumentTasksService) {}

  private async readCreateTaskRequest(req: FastifyRequest): Promise<{
    fields: CreateTaskFields;
    files: Array<{ filename: string; mimetype: string; content_b64: string }>;
  }> {
    const multipartReq = req as FastifyRequest & {
      parts?: () => AsyncIterable<MultipartLikePart>;
    };

    if (typeof multipartReq.parts === 'function' && isMultipartContentType(req)) {
      const fields: Record<string, unknown> = {};
      const files: Array<{ filename: string; mimetype: string; content_b64: string }> = [];

      for await (const part of multipartReq.parts()) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          files.push({
            filename: part.filename,
            mimetype: part.mimetype,
            content_b64: buffer.toString('base64'),
          });
          continue;
        }

        fields[part.fieldname] = part.value;
      }

      return {
        fields: {
          prompt: typeof fields.prompt === 'string' ? fields.prompt : undefined,
          pageId: typeof fields.pageId === 'string' ? fields.pageId : undefined,
          pageTitle:
            typeof fields.pageTitle === 'string' ? fields.pageTitle : undefined,
          pageContent:
            typeof fields.pageContent === 'string'
              ? fields.pageContent
              : undefined,
          taskType:
            typeof fields.taskType === 'string' ? fields.taskType : undefined,
          sourceScope:
            typeof fields.sourceScope === 'string'
              ? fields.sourceScope
              : undefined,
          mode: typeof fields.mode === 'string' ? fields.mode : undefined,
        },
        files,
      };
    }

    const body = (req.body as CreateTaskFields | undefined) ?? {};
    return { fields: body, files: [] };
  }

  @Post()
  async createTask(
    @Req() req: FastifyRequest,
    @AuthUser() user: any,
    @AuthWorkspace() workspace: any,
  ) {
    const { fields, files } = await this.readCreateTaskRequest(req);

    return this.documentTasksService.createTask({
      prompt: fields.prompt || '',
      pageId: fields.pageId,
      pageTitle: fields.pageTitle,
      pageContent: fields.pageContent,
      taskType: fields.taskType
        ? (fields.taskType as 'document_transform' | 'document_create')
        : undefined,
      sourceScope: fields.sourceScope
        ? (fields.sourceScope as 'uploaded_document' | 'current_page' | 'uploaded_plus_current_page')
        : undefined,
      mode: fields.mode
        ? (fields.mode as 'strict_preservation' | 'relaxed_optimization')
          : undefined,
      files,
      workspaceId: workspace.id,
      userId: user.id,
    });
  }

  @Post(':taskId/plan')
  async requestPlan(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.documentTasksService.requestPlan(taskId, body || {});
  }

  @Post(':taskId/diff')
  async requestDiff(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.documentTasksService.requestDiff(taskId, body || {});
  }

  @Post(':taskId/review')
  async submitReview(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.documentTasksService.submitReview(taskId, body || {});
  }

  @Post(':taskId/apply')
  async applyAcceptedChanges(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
    @AuthUser() user: any,
  ) {
    return this.documentTasksService.applyAcceptedChanges(taskId, (body || {}) as any, user);
  }

  @Post(':taskId/rollback')
  async rollbackAppliedChanges(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
    @AuthUser() user: any,
  ) {
    return this.documentTasksService.rollbackAppliedChanges(taskId, (body || {}) as any, user);
  }

  @Post(':taskId/collab')
  async resolveCollabDecision(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.documentTasksService.resolveCollabDecision(taskId, body || {});
  }
}
