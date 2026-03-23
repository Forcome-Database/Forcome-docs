# AI Creator面板实施计划

> **对于Claude：** 必须使用的子技能：使用超能力：executing-plans来逐个任务地实施该计划。

**目标：** 在右侧边栏添加一个AI Creator面板，具有三种模式：创建（文件上传+模板+流式写入）、编辑（替换选择）、聊天（无需编辑的对话框）。

**架构：** 使用新的 `"ai-creator"` 选项卡扩展现有的 Aside 面板。前端：8 个新的 React 组件 + Jotai 原子。后端：1 个新的 SSE 端点用于基于文件的创建，重用现有的 `/ai/generate/stream` 进行编辑/聊天模式。新的 `AiFileService` 处理 PDF/图像 (base64) 和 Word (mammoth → markdown)。

**技术栈：** React 18、Mantine 8、Jotai、TipTap 3、NestJS 11、Fastify multipart、Vercel AI SDK v6、mammoth

---

### 任务 1：后端 — 安装 mammoth and create AiFileService

**文件：**
- 修改：`apps/server/package.json` — 添加猛犸象依赖项
- 创建：`apps/server/src/ee/ai/services/ai-file.service.ts`

**第 1 步：安装猛犸象**

运行： `cd apps/server && pnpm add mammoth`
预期：猛犸象已添加到依赖项中

**第二步：创建AiFileService**

创建`apps/server/src/ee/ai/services/ai-file.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { MultipartFile } from '@fastify/multipart';

export interface AiContentPart {
  type: 'text' | 'image' | 'file';
  text?: string;
  data?: string;       // base64
  mimeType?: string;
}

@Injectable()
export class AiFileService {
  private readonly logger = new Logger(AiFileService.name);

  async processFiles(files: MultipartFile[]): Promise<AiContentPart[]> {
    const parts: AiContentPart[] = [];

    for (const file of files) {
      const buffer = await file.toBuffer();
      const mime = file.mimetype;

      if (mime === 'application/pdf') {
        const base64 = buffer.toString('base64');
        parts.push({ type: 'file', data: base64, mimeType: mime });
      } else if (mime.startsWith('image/')) {
        const base64 = buffer.toString('base64');
        parts.push({ type: 'image', data: base64, mimeType: mime });
      } else if (
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mammoth = require('mammoth');
        const result = await mammoth.convertToHtml({ buffer });
        // Simple HTML to text conversion preserving structure
        const text = result.value
          .replace(/<\/?(p|div|br|h[1-6])[^>]*>/gi, '\n')
          .replace(/<li[^>]*>/gi, '\n- ')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        parts.push({ type: 'text', text });
      } else {
        this.logger.warn(`Unsupported file type: ${mime}, skipping`);
      }
    }

    return parts;
  }
}
```

**第 3 步：承诺**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/ee/ai/services/ai-file.service.ts
git commit -m "feat(ai): add AiFileService for PDF/Word/image processing"
```

---

### 任务 2：后端 — 创建 templates and creator DTO

**文件：**
- 创建：`apps/server/src/ee/ai/constants/ai-templates.ts`
- 创建：`apps/server/src/ee/ai/dto/ai-creator.dto.ts`

**第 1 步：创建模板常量**

创建`apps/server/src/ee/ai/constants/ai-templates.ts`：

```typescript
export interface AiTemplate {
  key: string;
  name: string;
  prompt: string;
}

export const AI_TEMPLATES: Record<string, AiTemplate> = {
  'technical-doc': {
    key: 'technical-doc',
    name: '技术文档',
    prompt: `请根据提供的参考资料，按以下结构撰写技术文档：
1. 概述 — 项目背景和目标
2. 架构设计 — 系统架构和技术选型
3. 实现细节 — 核心模块和关键代码说明
4. 部署说明 — 环境要求和部署步骤
5. 常见问题 — FAQ

使用 Markdown 格式输出，包含适当的标题层级。`,
  },
  'meeting-notes': {
    key: 'meeting-notes',
    name: '会议纪要',
    prompt: `请根据提供的参考资料，按以下结构整理会议纪要：
1. 会议概要 — 时间、参与者、主题
2. 讨论要点 — 按议题分类列出关键讨论内容
3. 决议事项 — 明确达成的共识和决定
4. 待办跟进 — 负责人、截止日期、具体任务

使用 Markdown 格式输出。`,
  },
  'requirements': {
    key: 'requirements',
    name: '需求分析',
    prompt: `请根据提供的参考资料，按以下结构撰写需求分析文档：
1. 背景与目标
2. 用户画像与使用场景
3. 功能需求（按优先级排列）
4. 非功能需求（性能、安全、兼容性）
5. 验收标准

使用 Markdown 格式输出。`,
  },
  'report': {
    key: 'report',
    name: '研究报告',
    prompt: `请根据提供的参考资料，按以下结构撰写研究报告：
1. 摘要
2. 背景与研究动机
3. 方法与数据来源
4. 分析结果
5. 结论与建议

使用 Markdown 格式输出。`,
  },
  'prd': {
    key: 'prd',
    name: '产品 PRD',
    prompt: `请根据提供的参考资料，按以下结构撰写产品需求文档（PRD）：
1. 产品概述与目标
2. 用户故事
3. 功能设计（含交互说明）
4. 数据模型
5. 技术要求与约束
6. 里程碑与排期建议

使用 Markdown 格式输出。`,
  },
};
```

**第 2 步：创建DTO**

创建`apps/server/src/ee/ai/dto/ai-creator.dto.ts`：

```typescript
import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class AiCreatorGenerateDto {
  @IsNotEmpty()
  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  template?: string;

  @IsNotEmpty()
  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  @IsIn(['append', 'overwrite'])
  insertMode?: string;

  @IsOptional()
  @IsString()
  existingContentSummary?: string;

  @IsOptional()
  @IsString()
  pageTitle?: string;
}
```

**第 3 步：承诺**

```bash
git add apps/server/src/ee/ai/constants/ai-templates.ts apps/server/src/ee/ai/dto/ai-creator.dto.ts
git commit -m "feat(ai): add AI templates and creator DTO"
```

---

### 任务 3：后端 — 添加 streamWithFiles to AiService

**文件：**
- 修改：`apps/server/src/ee/ai/services/ai.service.ts:1-115` — 添加streamWithFiles方法

**第 1 步：添加streamWithFiles方法**

在 `generateStream` 方法之后添加到 `ai.service.ts`（第 92 行之后）：

```typescript
async *streamWithFiles(
  systemPrompt: string,
  contentParts: AiContentPart[],
): AsyncGenerator<string> {
  const model = this.getModel();

  // Build messages array with multi-modal content
  const userContent: any[] = [];

  // Add file content parts
  for (const part of contentParts) {
    if (part.type === 'text') {
      userContent.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      userContent.push({
        type: 'image',
        image: part.data,
        mimeType: part.mimeType,
      });
    } else if (part.type === 'file') {
      userContent.push({
        type: 'file',
        data: part.data,
        mimeType: part.mimeType,
      });
    }
  }

  // Add the prompt as final text part
  userContent.push({ type: 'text', text: systemPrompt });

  this.logger.debug(`Starting streamWithFiles, ${contentParts.length} content parts`);

  const result = streamText({
    model,
    messages: [
      {
        role: 'user',
        content: userContent,
      },
    ],
  });

  let chunks = 0;
  for await (const chunk of result.textStream) {
    chunks++;
    yield JSON.stringify({ content: chunk });
  }
  this.logger.debug(`streamWithFiles finished, total chunks: ${chunks}`);
}
```

还要在文件顶部添加导入：

```typescript
import { AiContentPart } from './ai-file.service';
```

**第 2 步：承诺**

```bash
git add apps/server/src/ee/ai/services/ai.service.ts
git commit -m "feat(ai): add streamWithFiles method for multi-modal content"
```

---

### 任务 4：后端 — 添加 creator/generate endpoint to AiController

**文件：**
- 修改：`apps/server/src/ee/ai/ai.controller.ts:1-119` — 添加creatorGenerate端点
- 修改：`apps/server/src/ee/ai/ai.module.ts:1-12` — 注册AiFileService

**第 1 步：更新AiModule以注册AiFileService**

修改`ai.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './services/ai.service';
import { AiSearchService } from './services/ai-search.service';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiFileService } from './services/ai-file.service';

@Module({
  controllers: [AiController],
  providers: [AiService, AiSearchService, AiQueueProcessor, AiFileService],
  exports: [AiService, AiSearchService],
})
export class AiModule {}
```

**步骤2：将creatorGenerate端点添加到AiController**

添加新的导入并注入 AiFileService，然后在现有的 `generateStream` 方法之后添加端点：

```typescript
// Additional imports at top:
import { AiFileService } from './services/ai-file.service';
import { AI_TEMPLATES } from './constants/ai-templates';
import { Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';

// Add to constructor:
constructor(
  private readonly aiService: AiService,
  private readonly aiSearchService: AiSearchService,
  private readonly aiFileService: AiFileService,
) {}

// New endpoint:
@UseGuards(JwtAuthGuard)
@Post('creator/generate')
async creatorGenerate(
  @Req() req: FastifyRequest,
  @AuthWorkspace() workspace: Workspace,
  @Res() res: FastifyReply,
) {
  this.checkAiGenerativeEnabled(workspace);

  // Parse multipart
  const parts = req.parts();
  const files = [];
  const fields: Record<string, string> = {};

  for await (const part of parts) {
    if (part.type === 'file') {
      if (files.length >= 5) continue;
      files.push(part);
    } else {
      fields[part.fieldname] = part.value as string;
    }
  }

  const { prompt, template, insertMode, existingContentSummary, pageTitle } = fields;

  if (!prompt) {
    res.status(400).send({ message: 'prompt is required' });
    return;
  }

  // Process files
  const contentParts = await this.aiFileService.processFiles(files);

  // Build system prompt
  let systemPrompt = '';

  // Add template instructions if selected
  if (template && AI_TEMPLATES[template]) {
    systemPrompt += AI_TEMPLATES[template].prompt + '\n\n';
  }

  // Add context if appending
  if (insertMode === 'append' && existingContentSummary) {
    systemPrompt += `当前页面标题：${pageTitle || '(无标题)'}\n`;
    systemPrompt += `页面现有内容摘要：\n${existingContentSummary}\n\n`;
    systemPrompt += '请续写内容，与已有内容风格和结构保持一致。\n\n';
  }

  systemPrompt += prompt;

  // Stream response
  res.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    let chunkCount = 0;
    for await (const chunk of this.aiService.streamWithFiles(systemPrompt, contentParts)) {
      chunkCount++;
      res.raw.write(`data: ${chunk}\n\n`);
    }
    this.logger.log(`AI creator stream completed: ${chunkCount} chunks sent`);
    res.raw.write('data: [DONE]\n\n');
  } catch (error: any) {
    this.logger.error(`AI creator stream error: ${error?.message}`);
    res.raw.write(
      `data: ${JSON.stringify({ error: error?.message || 'Unknown error' })}\n\n`,
    );
  } finally {
    res.raw.end();
  }
}
```

**第 3 步：承诺**

```bash
git add apps/server/src/ee/ai/ai.controller.ts apps/server/src/ee/ai/ai.module.ts
git commit -m "feat(ai): add creator/generate endpoint with file upload"
```

---

### 任务 5：前端 — 创建 Jotai atoms and types

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`

**第 1 步：创建类型**

创建`apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`：

```typescript
export type AiCreatorMode = 'create' | 'edit' | 'chat';

export type InsertMode = 'append' | 'overwrite';

export interface AiCreatorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: AiCreatorMode;
  timestamp: number;
}

export interface AiTemplate {
  key: string;
  name: string;
}

export const AI_TEMPLATE_OPTIONS: AiTemplate[] = [
  { key: 'technical-doc', name: '技术文档' },
  { key: 'meeting-notes', name: '会议纪要' },
  { key: 'requirements', name: '需求分析' },
  { key: 'report', name: '研究报告' },
  { key: 'prd', name: '产品 PRD' },
];
```

**第 2 步：创建原子**

创建`apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`：

```typescript
import { atom } from 'jotai';
import { AiCreatorMode, AiCreatorMessage, InsertMode } from './ai-creator.types';

export const aiCreatorModeAtom = atom<AiCreatorMode>('create');

export const aiCreatorModeLockAtom = atom<boolean>(false);

export const aiCreatorFilesAtom = atom<File[]>([]);

export const aiCreatorTemplateAtom = atom<string | null>(null);

export const aiCreatorSelectionAtom = atom<string>('');

// Selection position for edit mode
export const aiCreatorSelectionRangeAtom = atom<{ from: number; to: number } | null>(null);

export const aiCreatorMessagesAtom = atom<Record<string, AiCreatorMessage[]>>({});

export const aiCreatorStreamingAtom = atom<boolean>(false);

export const aiCreatorInsertModeAtom = atom<InsertMode>('append');
```

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/
git commit -m "feat(ai): add AI creator atoms and types"
```

---

### 任务 6：前端 — 创建 AI creator service

**文件：**
- 修改：`apps/client/src/ee/ai/services/ai-service.ts:1-92` — 添加creatorGenerate函数

**第 1 步：将creatorGenerate添加到ai-service.ts**

在现有的 `generateAiContentStream` 函数后添加：

```typescript
export async function creatorGenerate(
  data: {
    files: File[];
    prompt: string;
    template?: string;
    pageId: string;
    insertMode?: string;
    existingContentSummary?: string;
    pageTitle?: string;
  },
  onChunk: (chunk: AiStreamChunk) => void,
  onError?: (error: AiStreamError) => void,
  onComplete?: () => void,
): Promise<AbortController> {
  const abortController = new AbortController();

  try {
    const formData = new FormData();
    data.files.forEach((file) => formData.append('files', file));
    formData.append('prompt', data.prompt);
    if (data.template) formData.append('template', data.template);
    formData.append('pageId', data.pageId);
    if (data.insertMode) formData.append('insertMode', data.insertMode);
    if (data.existingContentSummary) formData.append('existingContentSummary', data.existingContentSummary);
    if (data.pageTitle) formData.append('pageTitle', data.pageTitle);

    const response = await fetch('/api/ai/creator/generate', {
      method: 'POST',
      body: formData,
      signal: abortController.signal,
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const processStream = async () => {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                onComplete?.();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  onError?.(parsed);
                } else {
                  onChunk(parsed);
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          onError?.({ error: error.message });
        }
      } finally {
        reader.releaseLock();
      }
    };

    processStream();
  } catch (error: any) {
    onError?.({ error: error.message });
  }

  return abortController;
}
```

**第 2 步：承诺**

```bash
git add apps/client/src/ee/ai/services/ai-service.ts
git commit -m "feat(ai): add creatorGenerate service for file-based creation"
```

---

### 任务 7：前端 — Wire AI Creator tab into Aside

**文件：**
- 修改：`apps/client/src/components/layouts/global/aside.tsx:1-57` — 添加 ai-creator 案例
- 修改：`apps/client/src/features/page/components/header/page-header-menu.tsx:72-102` — 添加AI按钮

**第 1 步：将 AI Creator 按钮添加到页眉**

在`page-header-menu.tsx`中，在顶部添加导入：

```typescript
import { IconSparkles } from "@tabler/icons-react";
```

在 ShareModal 和 Comments 按钮之间添加 AI 按钮（第 78 行之后，第 80 行之前）：

```tsx
{!readOnly && (
  <Tooltip label={t("AI Creator")} openDelay={250} withArrow>
    <ActionIcon
      variant="subtle"
      color="dark"
      onClick={() => toggleAside("ai-creator")}
    >
      <IconSparkles size={20} stroke={2} />
    </ActionIcon>
  </Tooltip>
)}
```

**第 2 步：将AI Creator案例添加到Aside**

在`aside.tsx`中，添加导入：

```typescript
import AiCreatorPanel from "@/ee/ai/components/ai-creator/ai-creator-panel";
```

在 switch 语句中添加 case（在 `"toc"` case 之后）：

```typescript
case "ai-creator":
  component = <AiCreatorPanel />;
  title = "AI Creator";
  break;
```

**第 3 步：承诺**

```bash
git add apps/client/src/components/layouts/global/aside.tsx apps/client/src/features/page/components/header/page-header-menu.tsx
git commit -m "feat(ai): wire AI Creator button and aside tab"
```

---

### 任务 8：前端 — 构建 AiCreatorPanel (main container)

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`

**第 1 步：创建主面板组件**

```typescript
import { useEffect, useCallback } from 'react';
import { Stack, ScrollArea } from '@mantine/core';
import { useAtom, useAtomValue } from 'jotai';
import { pageEditorAtom } from '@/features/editor/atoms/editor-atoms';
import {
  aiCreatorModeAtom,
  aiCreatorModeLockAtom,
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
} from './ai-creator-atoms';
import { AiCreatorModeSwitch } from './ai-creator-mode-switch';
import { AiCreatorSelection } from './ai-creator-selection';
import { AiCreatorMessages } from './ai-creator-messages';
import { AiCreatorInput } from './ai-creator-input';

export default function AiCreatorPanel() {
  const editor = useAtomValue(pageEditorAtom);
  const [mode, setMode] = useAtom(aiCreatorModeAtom);
  const [modeLock, setModeLock] = useAtom(aiCreatorModeLockAtom);
  const [, setSelection] = useAtom(aiCreatorSelectionAtom);
  const [, setSelectionRange] = useAtom(aiCreatorSelectionRangeAtom);

  // Listen to editor selection changes
  useEffect(() => {
    if (!editor) return;

    const onSelectionUpdate = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setSelection('');
        setSelectionRange(null);
        if (!modeLock) setMode('create');
        // Unlock when selection is cleared
        setModeLock(false);
      } else {
        const text = editor.state.doc.textBetween(from, to, '\n');
        setSelection(text);
        setSelectionRange({ from, to });
        if (!modeLock) setMode('edit');
      }
    };

    editor.on('selectionUpdate', onSelectionUpdate);
    // Run once on mount to capture existing selection
    onSelectionUpdate();

    return () => {
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [editor, modeLock]);

  const hasSelection = useAtomValue(aiCreatorSelectionAtom).length > 0;

  return (
    <Stack h="calc(100vh - 100px)" gap={0}>
      {/* Mode switch - only when there's a selection */}
      {hasSelection && <AiCreatorModeSwitch />}

      {/* Selection preview - edit/chat modes */}
      {hasSelection && (mode === 'edit' || mode === 'chat') && (
        <AiCreatorSelection />
      )}

      {/* Messages area */}
      <ScrollArea
        style={{ flex: 1 }}
        scrollbarSize={5}
        type="scroll"
      >
        <AiCreatorMessages />
      </ScrollArea>

      {/* Input area - always visible */}
      <AiCreatorInput />
    </Stack>
  );
}
```

**第 2 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx
git commit -m "feat(ai): create AiCreatorPanel main container"
```

---

### 任务 9：前端 — 构建 mode switch and selection preview

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-mode-switch.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`

**第 1 步：创建模式开关**

```typescript
import { SegmentedControl, Box } from '@mantine/core';
import { useAtom } from 'jotai';
import { aiCreatorModeAtom, aiCreatorModeLockAtom } from './ai-creator-atoms';
import { useTranslation } from 'react-i18next';
import { AiCreatorMode } from './ai-creator.types';

export function AiCreatorModeSwitch() {
  const { t } = useTranslation();
  const [mode, setMode] = useAtom(aiCreatorModeAtom);
  const [, setModeLock] = useAtom(aiCreatorModeLockAtom);

  const handleChange = (value: string) => {
    setMode(value as AiCreatorMode);
    setModeLock(true);
  };

  return (
    <Box px="xs" py="xs">
      <SegmentedControl
        size="xs"
        fullWidth
        value={mode}
        onChange={handleChange}
        data={[
          { label: t('Edit'), value: 'edit' },
          { label: t('Chat'), value: 'chat' },
        ]}
      />
    </Box>
  );
}
```

**第 2 步：创建选择预览**

```typescript
import { Box, Text } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { aiCreatorSelectionAtom } from './ai-creator-atoms';

export function AiCreatorSelection() {
  const selection = useAtomValue(aiCreatorSelectionAtom);

  if (!selection) return null;

  return (
    <Box
      mx="xs"
      mb="xs"
      p="xs"
      style={{
        backgroundColor: 'var(--mantine-color-gray-1)',
        borderRadius: 'var(--mantine-radius-sm)',
        borderLeft: '3px solid var(--mantine-color-blue-5)',
        maxHeight: 120,
        overflow: 'auto',
      }}
    >
      <Text size="xs" c="dimmed" mb={4}>
        Selected text
      </Text>
      <Text size="sm" lineClamp={5} style={{ whiteSpace: 'pre-wrap' }}>
        {selection}
      </Text>
    </Box>
  );
}
```

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-mode-switch.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx
git commit -m "feat(ai): add mode switch and selection preview components"
```

---

### 任务 10：前端 — 构建 messages list and message item

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`

**第 1 步：创建消息项**

```typescript
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { IconClipboard, IconArrowBarDown } from '@tabler/icons-react';
import { useAtomValue } from 'jotai';
import { pageEditorAtom } from '@/features/editor/atoms/editor-atoms';
import { notifications } from '@mantine/notifications';
import { AiCreatorMessage } from './ai-creator.types';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';

interface Props {
  message: AiCreatorMessage;
}

export function AiCreatorMessageItem({ message }: Props) {
  const { t } = useTranslation();
  const editor = useAtomValue(pageEditorAtom);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    notifications.show({ message: t('Copied') });
  };

  const handleInsert = () => {
    if (!editor) return;
    const html = (marked.parse(message.content) as string).trim();
    editor.chain().focus().insertContent(html).run();
    notifications.show({ message: t('Inserted') });
  };

  return (
    <Box
      mb="sm"
      p="xs"
      style={{
        backgroundColor: isUser
          ? 'var(--mantine-color-blue-0)'
          : 'var(--mantine-color-gray-0)',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
    >
      <Text size="xs" fw={600} c="dimmed" mb={4}>
        {isUser ? t('You') : 'AI'}
      </Text>
      {isUser ? (
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {message.content}
        </Text>
      ) : (
        <Box
          size="sm"
          dangerouslySetInnerHTML={{
            __html: marked.parse(message.content) as string,
          }}
          style={{ fontSize: 'var(--mantine-font-size-sm)' }}
        />
      )}

      {/* Actions - only for AI messages in chat mode */}
      {!isUser && message.mode === 'chat' && (
        <Group gap="xs" mt="xs">
          <Tooltip label={t('Copy')}>
            <ActionIcon variant="subtle" size="xs" onClick={handleCopy}>
              <IconClipboard size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('Insert to editor')}>
            <ActionIcon variant="subtle" size="xs" onClick={handleInsert}>
              <IconArrowBarDown size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      )}
    </Box>
  );
}
```

**第 2 步：创建消息列表**

```typescript
import { Box, Text, Loader, Group } from '@mantine/core';
import { useAtom, useAtomValue } from 'jotai';
import { useParams } from 'react-router-dom';
import { extractPageSlugId } from '@/lib';
import { aiCreatorMessagesAtom, aiCreatorStreamingAtom } from './ai-creator-atoms';
import { AiCreatorMessageItem } from './ai-creator-message-item';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export function AiCreatorMessages() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const [allMessages] = useAtom(aiCreatorMessagesAtom);
  const isStreaming = useAtomValue(aiCreatorStreamingAtom);
  const messages = allMessages[pageId] || [];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <Box p="md" ta="center">
        <Text size="sm" c="dimmed">
          {t('Start creating with AI')}
        </Text>
      </Box>
    );
  }

  return (
    <Box p="xs">
      {messages.map((msg) => (
        <AiCreatorMessageItem key={msg.id} message={msg} />
      ))}
      {isStreaming && (
        <Group gap="xs" p="xs">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">{t('AI is writing...')}</Text>
        </Group>
      )}
      <div ref={bottomRef} />
    </Box>
  );
}
```

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx
git commit -m "feat(ai): add messages list and message item components"
```

---

### 任务 11：前端 — 构建 file list and template selector

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-file-list.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-templates.tsx`

**第 1 步：创建文件列表**

```typescript
import { ActionIcon, Badge, Group } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useAtom } from 'jotai';
import { aiCreatorFilesAtom } from './ai-creator-atoms';

export function AiCreatorFileList() {
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);

  if (files.length === 0) return null;

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Group gap="xs" px="xs" pb="xs" wrap="wrap">
      {files.map((file, index) => (
        <Badge
          key={`${file.name}-${index}`}
          variant="light"
          size="sm"
          rightSection={
            <ActionIcon
              variant="transparent"
              size="xs"
              onClick={() => removeFile(index)}
            >
              <IconX size={12} />
            </ActionIcon>
          }
        >
          {file.name.length > 20
            ? file.name.slice(0, 17) + '...'
            : file.name}
        </Badge>
      ))}
    </Group>
  );
}
```

**第 2 步：创建模板选择器**

```typescript
import { Select } from '@mantine/core';
import { useAtom } from 'jotai';
import { aiCreatorTemplateAtom } from './ai-creator-atoms';
import { AI_TEMPLATE_OPTIONS } from './ai-creator.types';
import { useTranslation } from 'react-i18next';

export function AiCreatorTemplates() {
  const { t } = useTranslation();
  const [template, setTemplate] = useAtom(aiCreatorTemplateAtom);

  return (
    <Select
      size="xs"
      placeholder={t('Template (optional)')}
      value={template}
      onChange={setTemplate}
      clearable
      data={AI_TEMPLATE_OPTIONS.map((t) => ({
        value: t.key,
        label: t.name,
      }))}
      styles={{ root: { paddingLeft: 'var(--mantine-spacing-xs)', paddingRight: 'var(--mantine-spacing-xs)', paddingBottom: 'var(--mantine-spacing-xs)' } }}
    />
  );
}
```

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-file-list.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-templates.tsx
git commit -m "feat(ai): add file list and template selector components"
```

---

### 任务 12：前端 — 构建 AiCreatorInput (the core interaction component)

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

**第 1 步：创建输入组件**

这是最复杂的组件——处理所有三种模式的文件上传、提示提交和流管理。

```typescript
import { useCallback, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  SegmentedControl,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowUp,
  IconPaperclip,
  IconPlayerStop,
} from '@tabler/icons-react';
import { useAtom, useAtomValue } from 'jotai';
import { useParams } from 'react-router-dom';
import { extractPageSlugId } from '@/lib';
import { pageEditorAtom, titleEditorAtom } from '@/features/editor/atoms/editor-atoms';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import { v7 as uuid7 } from 'uuid';
import {
  aiCreatorModeAtom,
  aiCreatorFilesAtom,
  aiCreatorTemplateAtom,
  aiCreatorSelectionAtom,
  aiCreatorSelectionRangeAtom,
  aiCreatorMessagesAtom,
  aiCreatorStreamingAtom,
  aiCreatorInsertModeAtom,
} from './ai-creator-atoms';
import { AiCreatorFileList } from './ai-creator-file-list';
import { AiCreatorTemplates } from './ai-creator-templates';
import { AiCreatorMessage } from './ai-creator.types';
import {
  creatorGenerate,
  generateAiContentStream,
} from '@/ee/ai/services/ai-service';
import { AiAction } from '@/ee/ai/types/ai.types';

const ACCEPTED_FILES = '.pdf,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp';
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function AiCreatorInput() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const pageId = extractPageSlugId(pageSlug);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const mode = useAtomValue(aiCreatorModeAtom);
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);
  const template = useAtomValue(aiCreatorTemplateAtom);
  const selection = useAtomValue(aiCreatorSelectionAtom);
  const selectionRange = useAtomValue(aiCreatorSelectionRangeAtom);
  const [allMessages, setAllMessages] = useAtom(aiCreatorMessagesAtom);
  const [isStreaming, setIsStreaming] = useAtom(aiCreatorStreamingAtom);
  const [insertMode, setInsertMode] = useAtom(aiCreatorInsertModeAtom);
  const [prompt, setPrompt] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pageHasContent = editor && editor.state.doc.textContent.trim().length > 0;
  const pageTitle = titleEditor?.state.doc.textContent || '';

  const addMessage = useCallback(
    (msg: AiCreatorMessage) => {
      setAllMessages((prev) => {
        const pageMessages = prev[pageId] || [];
        return { ...prev, [pageId]: [...pageMessages, msg] };
      });
    },
    [pageId, setAllMessages],
  );

  const updateLastMessage = useCallback(
    (updater: (content: string) => string) => {
      setAllMessages((prev) => {
        const pageMessages = [...(prev[pageId] || [])];
        const last = pageMessages[pageMessages.length - 1];
        if (last && last.role === 'assistant') {
          pageMessages[pageMessages.length - 1] = {
            ...last,
            content: updater(last.content),
          };
        }
        return { ...prev, [pageId]: pageMessages };
      });
    },
    [pageId, setAllMessages],
  );

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    const validFiles = newFiles.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        notifications.show({
          color: 'red',
          message: `${f.name} exceeds 20MB limit`,
        });
        return false;
      }
      return true;
    });
    setFiles((prev) => [...prev, ...validFiles].slice(0, MAX_FILES));
    e.target.value = '';
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || isStreaming || !editor) return;

    const userPrompt = prompt.trim();
    setPrompt('');
    setIsStreaming(true);

    // Add user message
    addMessage({
      id: uuid7(),
      role: 'user',
      content: userPrompt,
      mode,
      timestamp: Date.now(),
    });

    // Add placeholder AI message
    const aiMsgId = uuid7();
    addMessage({
      id: aiMsgId,
      role: 'assistant',
      content: '',
      mode,
      timestamp: Date.now(),
    });

    const startTime = Date.now();
    let insertPos: number | null = null;

    try {
      if (mode === 'create') {
        // --- CREATE MODE ---
        if (insertMode === 'overwrite') {
          editor.commands.clearContent();
        }
        insertPos = editor.state.doc.content.size - 1;

        // Accumulate markdown, then batch-insert
        let accumulatedContent = '';

        abortRef.current = await creatorGenerate(
          {
            files,
            prompt: userPrompt,
            template: template || undefined,
            pageId,
            insertMode,
            existingContentSummary: pageHasContent
              ? editor.state.doc.textBetween(0, Math.min(500, editor.state.doc.content.size))
              : undefined,
            pageTitle,
          },
          (chunk) => {
            accumulatedContent += chunk.content;
            updateLastMessage(() => accumulatedContent);
          },
          (error) => {
            notifications.show({ color: 'red', message: error.error });
            setIsStreaming(false);
          },
          () => {
            // On complete: insert full content into editor
            if (accumulatedContent) {
              const html = (marked.parse(accumulatedContent) as string).trim();
              editor.chain().focus('end').insertContent(html).run();
            }
            setIsStreaming(false);
            setFiles([]);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
          },
        );
      } else if (mode === 'edit') {
        // --- EDIT MODE ---
        let accumulatedContent = '';
        const range = selectionRange;

        abortRef.current = await generateAiContentStream(
          {
            action: AiAction.CUSTOM,
            content: selection,
            prompt: userPrompt,
          },
          (chunk) => {
            accumulatedContent += chunk.content;
            updateLastMessage(() => accumulatedContent);
          },
          (error) => {
            notifications.show({ color: 'red', message: error.error });
            setIsStreaming(false);
          },
          () => {
            // On complete: replace selection
            if (accumulatedContent && range) {
              const html = (marked.parse(accumulatedContent) as string).trim();
              editor
                .chain()
                .focus()
                .setTextSelection(range)
                .insertContent(html)
                .run();
            }
            setIsStreaming(false);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
          },
        );
      } else {
        // --- CHAT MODE ---
        abortRef.current = await generateAiContentStream(
          {
            action: AiAction.CUSTOM,
            content: selection,
            prompt: userPrompt,
          },
          (chunk) => {
            updateLastMessage((prev) => prev + chunk.content);
          },
          (error) => {
            notifications.show({ color: 'red', message: error.error });
            setIsStreaming(false);
          },
          () => {
            setIsStreaming(false);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            updateLastMessage((c) => c + `\n\n---\n*${elapsed}s*`);
          },
        );
      }
    } catch (error: any) {
      notifications.show({ color: 'red', message: error.message });
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Box
      style={{
        borderTop: '1px solid var(--mantine-color-gray-2)',
        flexShrink: 0,
      }}
      pt="xs"
    >
      {/* Context hint for create mode */}
      {mode === 'create' && pageHasContent && (
        <Box px="xs" pb="xs">
          <Text size="xs" c="dimmed" mb={4}>
            {t('Page has existing content')}
          </Text>
          <SegmentedControl
            size="xs"
            fullWidth
            value={insertMode}
            onChange={(v) => setInsertMode(v as any)}
            data={[
              { label: t('Append'), value: 'append' },
              { label: t('Overwrite'), value: 'overwrite' },
            ]}
          />
        </Box>
      )}

      {/* File list - create mode only */}
      {mode === 'create' && <AiCreatorFileList />}

      {/* Template selector - create mode only */}
      {mode === 'create' && <AiCreatorTemplates />}

      {/* Input row */}
      <Box px="xs" pb="xs">
        <Group gap="xs" align="flex-end">
          {mode === 'create' && (
            <>
              <Tooltip label={t('Upload files')}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={handleFileUpload}
                  disabled={isStreaming || files.length >= MAX_FILES}
                >
                  <IconPaperclip size={16} />
                </ActionIcon>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILES}
                multiple
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </>
          )}

          <Textarea
            style={{ flex: 1 }}
            size="sm"
            placeholder={
              mode === 'create'
                ? t('Describe what to create...')
                : mode === 'edit'
                  ? t('Describe how to edit...')
                  : t('Ask about the selected text...')
            }
            autosize
            minRows={1}
            maxRows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />

          {isStreaming ? (
            <ActionIcon
              variant="filled"
              color="red"
              radius="xl"
              size="sm"
              onClick={handleStop}
            >
              <IconPlayerStop size={14} />
            </ActionIcon>
          ) : (
            <ActionIcon
              variant="filled"
              color="blue"
              radius="xl"
              size="sm"
              onClick={handleSubmit}
              disabled={!prompt.trim()}
            >
              <IconArrowUp size={14} stroke={2.5} />
            </ActionIcon>
          )}
        </Group>
      </Box>
    </Box>
  );
}
```

**第 2 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx
git commit -m "feat(ai): add AiCreatorInput with file upload, templates, and streaming"
```

---

### 任务 13：前端 — 添加 AI writing highlight decoration

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css`

**第 1 步：为AI Creator创建CSS模块**

```css
.aiWritingHighlight {
  background-color: rgba(59, 130, 246, 0.12);
  transition: background-color 1.5s ease;
}

.aiWritingDone {
  background-color: transparent;
}
```

注意：用于实时突出显示的完整 ProseMirror Decoration 集成可以作为后续添加。当前的实现使用更简单的方法，即在流结束后插入完整的内容，该方法与本机 TipTap 撤消配合使用。

**第 2 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css
git commit -m "feat(ai): add AI writing highlight styles"
```

---

### 任务 14：验证并修复 — 运行 build, test, fix issues

**第 1 步：运行前端类型检查**

运行： `cd apps/client && npx tsc --noEmit`
预期：没有类型错误。修复出现的任何问题。

**第 2 步：运行后端类型检查**

运行： `cd apps/server && npx tsc --noEmit`
预期：没有类型错误。修复出现的任何问题。

**步骤 3：运行开发服务器并手动测试**

运行： `pnpm dev`

手动测试清单：
- [ ] AI Creator 按钮出现在页面标题中（闪烁图标）
- [ ] 单击打开带有“AI Creator”标题的右侧面板
- [ ] 面板默认显示创建模式（无需选择）
- [ ] 文件上传作品（PDF、Word、图像）
- [ ] 模板下拉列表显示 5 个选项
- [ ] 在编辑器中选择文本切换到编辑模式
- [ ] [编辑 | Chat] 切换随选择一起出现
- [ ] 清除选择返回创建模式
- [ ] 创建模式：发送到`/api/ai/creator/generate`，内容出现在编辑器中
- [ ] 编辑模式：发送到 `/api/ai/generate/stream`，替换选择
- [ ] 聊天模式：AI 回复出现在面板中，而不是编辑器中
- [ ] 复制和插入按钮适用于聊天消息
- [ ] 停止按钮在流媒体期间起作用
- [ ] Ctrl+Z 撤消 AI 插入的内容
- [ ]“页面已存在内容”提示显示追加/覆盖切换
- [ ] 评审/目录按钮仍然独立工作

**第 4 步：最终提交**

```bash
git add -A
git commit -m "feat(ai): complete AI Creator panel with create/edit/chat modes"
```

---

## 所有文件的摘要

### 新文件（11）：
1. `apps/server/src/ee/ai/services/ai-file.service.ts`
2. `apps/server/src/ee/ai/constants/ai-templates.ts`
3. `apps/server/src/ee/ai/dto/ai-creator.dto.ts`
4. `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`
5. `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`
6. `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
7. `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`
8. `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
9. `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
10. `apps/client/src/ee/ai/components/ai-creator/ai-creator-mode-switch.tsx`
11. `apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`
12. `apps/client/src/ee/ai/components/ai-creator/ai-creator-file-list.tsx`
13. `apps/client/src/ee/ai/components/ai-creator/ai-creator-templates.tsx`
14. `apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css`

###修改文件(5):
1. `apps/server/package.json` — 添加猛犸象
2. `apps/server/src/ee/ai/ai.module.ts` — 注册AiFileService
3. `apps/server/src/ee/ai/ai.controller.ts` — 添加创建者/生成端点
4. `apps/server/src/ee/ai/services/ai.service.ts` — 添加streamWithFiles
5. `apps/client/src/components/layouts/global/aside.tsx` — 添加 ai-creator 选项卡
6. `apps/client/src/features/page/components/header/page-header-menu.tsx` — 添加AI按钮
7. `apps/client/src/ee/ai/services/ai-service.ts` — 添加creatorGenerate函数
