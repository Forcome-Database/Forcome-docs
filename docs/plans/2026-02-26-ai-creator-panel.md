# AI Creator Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI Creator panel to the right sidebar with three modes: Create (file upload + template + streaming write), Edit (replace selection), Chat (dialog without editing).

**Architecture:** Extend existing Aside panel with new `"ai-creator"` tab. Frontend: 8 new React components + Jotai atoms. Backend: 1 new SSE endpoint for file-based creation, reuse existing `/ai/generate/stream` for edit/chat modes. New `AiFileService` handles PDF/image (base64) and Word (mammoth → markdown).

**Tech Stack:** React 18, Mantine 8, Jotai, TipTap 3, NestJS 11, Fastify multipart, Vercel AI SDK v6, mammoth

---

### Task 1: Backend — Install mammoth and create AiFileService

**Files:**
- Modify: `apps/server/package.json` — add mammoth dependency
- Create: `apps/server/src/ee/ai/services/ai-file.service.ts`

**Step 1: Install mammoth**

Run: `cd apps/server && pnpm add mammoth`
Expected: mammoth added to dependencies

**Step 2: Create AiFileService**

Create `apps/server/src/ee/ai/services/ai-file.service.ts`:

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

**Step 3: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/ee/ai/services/ai-file.service.ts
git commit -m "feat(ai): add AiFileService for PDF/Word/image processing"
```

---

### Task 2: Backend — Create templates and creator DTO

**Files:**
- Create: `apps/server/src/ee/ai/constants/ai-templates.ts`
- Create: `apps/server/src/ee/ai/dto/ai-creator.dto.ts`

**Step 1: Create templates constant**

Create `apps/server/src/ee/ai/constants/ai-templates.ts`:

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

**Step 2: Create DTO**

Create `apps/server/src/ee/ai/dto/ai-creator.dto.ts`:

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

**Step 3: Commit**

```bash
git add apps/server/src/ee/ai/constants/ai-templates.ts apps/server/src/ee/ai/dto/ai-creator.dto.ts
git commit -m "feat(ai): add AI templates and creator DTO"
```

---

### Task 3: Backend — Add streamWithFiles to AiService

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai.service.ts:1-115` — add streamWithFiles method

**Step 1: Add streamWithFiles method**

Add to `ai.service.ts` after the `generateStream` method (after line 92):

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

Also add the import at top of file:

```typescript
import { AiContentPart } from './ai-file.service';
```

**Step 2: Commit**

```bash
git add apps/server/src/ee/ai/services/ai.service.ts
git commit -m "feat(ai): add streamWithFiles method for multi-modal content"
```

---

### Task 4: Backend — Add creator/generate endpoint to AiController

**Files:**
- Modify: `apps/server/src/ee/ai/ai.controller.ts:1-119` — add creatorGenerate endpoint
- Modify: `apps/server/src/ee/ai/ai.module.ts:1-12` — register AiFileService

**Step 1: Update AiModule to register AiFileService**

Modify `ai.module.ts`:

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

**Step 2: Add creatorGenerate endpoint to AiController**

Add new imports and inject AiFileService, then add the endpoint after the existing `generateStream` method:

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

**Step 3: Commit**

```bash
git add apps/server/src/ee/ai/ai.controller.ts apps/server/src/ee/ai/ai.module.ts
git commit -m "feat(ai): add creator/generate endpoint with file upload"
```

---

### Task 5: Frontend — Create Jotai atoms and types

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`

**Step 1: Create types**

Create `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`:

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

**Step 2: Create atoms**

Create `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`:

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

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/
git commit -m "feat(ai): add AI creator atoms and types"
```

---

### Task 6: Frontend — Create AI creator service

**Files:**
- Modify: `apps/client/src/ee/ai/services/ai-service.ts:1-92` — add creatorGenerate function

**Step 1: Add creatorGenerate to ai-service.ts**

Add after the existing `generateAiContentStream` function:

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

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/services/ai-service.ts
git commit -m "feat(ai): add creatorGenerate service for file-based creation"
```

---

### Task 7: Frontend — Wire AI Creator tab into Aside

**Files:**
- Modify: `apps/client/src/components/layouts/global/aside.tsx:1-57` — add ai-creator case
- Modify: `apps/client/src/features/page/components/header/page-header-menu.tsx:72-102` — add AI button

**Step 1: Add AI Creator button to page header**

In `page-header-menu.tsx`, add import at top:

```typescript
import { IconSparkles } from "@tabler/icons-react";
```

Add AI button between ShareModal and Comments button (after line 78, before line 80):

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

**Step 2: Add AI Creator case to Aside**

In `aside.tsx`, add import:

```typescript
import AiCreatorPanel from "@/ee/ai/components/ai-creator/ai-creator-panel";
```

Add case in the switch statement (after the `"toc"` case):

```typescript
case "ai-creator":
  component = <AiCreatorPanel />;
  title = "AI Creator";
  break;
```

**Step 3: Commit**

```bash
git add apps/client/src/components/layouts/global/aside.tsx apps/client/src/features/page/components/header/page-header-menu.tsx
git commit -m "feat(ai): wire AI Creator button and aside tab"
```

---

### Task 8: Frontend — Build AiCreatorPanel (main container)

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`

**Step 1: Create main panel component**

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

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx
git commit -m "feat(ai): create AiCreatorPanel main container"
```

---

### Task 9: Frontend — Build mode switch and selection preview

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-mode-switch.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx`

**Step 1: Create mode switch**

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

**Step 2: Create selection preview**

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

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-mode-switch.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx
git commit -m "feat(ai): add mode switch and selection preview components"
```

---

### Task 10: Frontend — Build messages list and message item

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`

**Step 1: Create message item**

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

**Step 2: Create messages list**

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

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx
git commit -m "feat(ai): add messages list and message item components"
```

---

### Task 11: Frontend — Build file list and template selector

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-file-list.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-templates.tsx`

**Step 1: Create file list**

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

**Step 2: Create template selector**

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

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-file-list.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-templates.tsx
git commit -m "feat(ai): add file list and template selector components"
```

---

### Task 12: Frontend — Build AiCreatorInput (the core interaction component)

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

**Step 1: Create input component**

This is the most complex component — handles file upload, prompt submission, and stream management for all three modes.

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

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx
git commit -m "feat(ai): add AiCreatorInput with file upload, templates, and streaming"
```

---

### Task 13: Frontend — Add AI writing highlight decoration

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css`

**Step 1: Create CSS module for AI creator**

```css
.aiWritingHighlight {
  background-color: rgba(59, 130, 246, 0.12);
  transition: background-color 1.5s ease;
}

.aiWritingDone {
  background-color: transparent;
}
```

Note: Full ProseMirror Decoration integration for real-time highlighting can be added as a follow-up. The current implementation uses the simpler approach of inserting complete content after stream ends, which works with native TipTap undo.

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css
git commit -m "feat(ai): add AI writing highlight styles"
```

---

### Task 14: Verify and fix — Run build, test, fix issues

**Step 1: Run frontend type check**

Run: `cd apps/client && npx tsc --noEmit`
Expected: No type errors. Fix any that appear.

**Step 2: Run backend type check**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No type errors. Fix any that appear.

**Step 3: Run dev servers and test manually**

Run: `pnpm dev`

Manual testing checklist:
- [ ] AI Creator button appears in page header (sparkles icon)
- [ ] Clicking opens right panel with "AI Creator" title
- [ ] Panel shows create mode by default (no selection)
- [ ] File upload works (PDF, Word, images)
- [ ] Template dropdown shows 5 options
- [ ] Selecting text in editor switches to edit mode
- [ ] [Edit | Chat] toggle appears with selection
- [ ] Clearing selection returns to create mode
- [ ] Create mode: sends to `/api/ai/creator/generate`, content appears in editor
- [ ] Edit mode: sends to `/api/ai/generate/stream`, replaces selection
- [ ] Chat mode: AI response appears in panel, not in editor
- [ ] Copy and Insert buttons work on chat messages
- [ ] Stop button works during streaming
- [ ] Ctrl+Z undoes AI-inserted content
- [ ] "Page has existing content" hint shows append/overwrite toggle
- [ ] Comment/TOC buttons still work independently

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(ai): complete AI Creator panel with create/edit/chat modes"
```

---

## Summary of All Files

### New files (11):
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

### Modified files (5):
1. `apps/server/package.json` — add mammoth
2. `apps/server/src/ee/ai/ai.module.ts` — register AiFileService
3. `apps/server/src/ee/ai/ai.controller.ts` — add creator/generate endpoint
4. `apps/server/src/ee/ai/services/ai.service.ts` — add streamWithFiles
5. `apps/client/src/components/layouts/global/aside.tsx` — add ai-creator tab
6. `apps/client/src/features/page/components/header/page-header-menu.tsx` — add AI button
7. `apps/client/src/ee/ai/services/ai-service.ts` — add creatorGenerate function
