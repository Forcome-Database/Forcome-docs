# AI 提示词与模板管理系统 — 重构细节

## 概述

实现 AI 模板的三层覆盖架构（系统默认 → 管理员工作区级 → 用户个人级），管理员可维护默认模板和全局系统提示词，普通用户可创建仅自己可见的个人模板。

## 架构设计

### 三层覆盖模型

```
优先级：用户模板 > 工作区模板 > 系统默认模板

┌─────────────────────────────────────────────┐
│  Layer 3: 用户模板 (scope='user')           │  ← 仅本人可见，本人可编辑/删除
│  存储在 DB, creator_id = 当前用户           │
├─────────────────────────────────────────────┤
│  Layer 2: 工作区模板 (scope='workspace')    │  ← 管理员管理，全员可见
│  存储在 DB, 首次访问时从系统默认种子        │
├─────────────────────────────────────────────┤
│  Layer 1: 系统默认 (代码常量)               │  ← 6 个内置模板，作为种子和兜底
│  保留在 ai-templates.ts                     │
└─────────────────────────────────────────────┘
```

### 解析算法

```
getResolvedTemplates(workspaceId, userId, isAdmin):
  resolved = Map()
  1. 系统默认 → resolved.set(key, { ...t, source:'system' })
  2. 工作区模板 → resolved.set(key, { ...t, source:'workspace' })  // 覆盖同 key
     - description/icon 为 null 时回退到下层值（nullish coalescing）
  3. 用户模板 → resolved.set(key, { ...t, source:'user' })
     - description/icon 同上回退逻辑
  4. 每个模板计算 canEdit/canDelete 权限标记
  return sorted array
```

### 全局系统提示词

存储在 `workspace.settings.ai.systemPrompt`（JSONB 字段），拼接在所有 AI Creator 请求的最前面。

### 权限模型

| 角色 | 默认模板 (workspace) | 个人模板 (user) | 全局系统提示词 |
|------|---------------------|----------------|---------------|
| **管理员** | 新增 / 编辑 / 删除（种子模板不可删） | 新增 / 编辑 / 删除 | 读写 |
| **普通用户** | 只读（选择使用） | 新增 / 编辑 / 删除（仅自己的） | 只读（自动应用） |

后端通过 CASL 的 `WorkspaceCaslAction.Manage + Settings` 判断管理员权限，API 返回每个模板的 `canEdit`/`canDelete` 标记供前端渲染。

---

## 数据库设计

### 新表：`ai_prompt_templates`

```sql
CREATE TABLE ai_prompt_templates (
  id           UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
  key          VARCHAR NOT NULL,        -- 模板标识符 e.g. 'technical-doc'
  name         VARCHAR NOT NULL,        -- 显示名称
  description  TEXT,                    -- 简短描述
  icon         VARCHAR,                 -- 图标标识 e.g. 'IconFileCode'
  prompt       TEXT NOT NULL,           -- 系统提示词内容
  scope        VARCHAR NOT NULL,        -- 'workspace' | 'user'
  workspace_id UUID NOT NULL → workspaces(id) CASCADE,
  creator_id   UUID NOT NULL → users(id) CASCADE,
  is_default   BOOLEAN DEFAULT false,   -- 系统默认种子标记
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  deleted_at   TIMESTAMPTZ             -- 软删除
);

-- 索引
UNIQUE (workspace_id, key) WHERE scope='workspace' AND deleted_at IS NULL
UNIQUE (workspace_id, creator_id, key) WHERE scope='user' AND deleted_at IS NULL
INDEX  (workspace_id, scope) WHERE deleted_at IS NULL
```

### 懒加载种子机制

首次调用 `/api/ai/templates/list` 时，`ensureSeedTemplates()` 检查工作区是否已有模板：
- 无模板 → 从 `AI_TEMPLATES` 常量批量插入 6 个 workspace 级种子
- 有模板但种子缺少 description/icon → backfill 更新（兼容旧数据）

---

## API 端点

所有端点使用 POST 方法，前缀 `/api/ai/templates/`。

| 端点 | 权限 | 说明 |
|------|------|------|
| `POST /api/ai/templates/list` | 所有登录用户 | 返回当前用户的解析后模板列表（含权限标记） |
| `POST /api/ai/templates/create` | Admin(workspace) / User(user) | 创建模板，scope 决定权限要求 |
| `POST /api/ai/templates/update` | 模板所有者 | 更新模板（admin 可改 workspace 级，user 只能改自己的） |
| `POST /api/ai/templates/delete` | 模板所有者 | 软删除模板（种子模板 admin 也不可删） |
| `POST /api/ai/templates/reset` | 用户自己 | 删除用户对某 key 的个人覆盖 |
| `POST /api/ai/templates/system-prompt` | 所有登录用户 | 获取全局系统提示词 |
| `POST /api/ai/templates/system-prompt/update` | Admin | 设置全局系统提示词 |

### 返回结构（list 端点）

```json
{
  "data": {
    "templates": [
      {
        "id": "uuid",
        "key": "technical-doc",
        "name": "技术文档",
        "description": "系统架构、API 文档",
        "icon": "IconFileCode",
        "prompt": "你是一位资深技术文档工程师...",
        "scope": "workspace",
        "source": "workspace",
        "isDefault": true,
        "canReset": false,
        "canEdit": true,
        "canDelete": false
      }
    ]
  },
  "success": true,
  "status": 200
}
```

> **注意**：所有响应经过 `TransformHttpResponseInterceptor` 包装，前端 API 函数必须通过 `(await api.post(...)).data` 解包。

---

## 新建文件清单（共 11 个）

### 后端（5 个）

| 文件 | 说明 |
|------|------|
| `apps/server/src/database/migrations/20260227T120000-ai-prompt-templates.ts` | 数据库迁移：建表 + 3 个索引 |
| `apps/server/src/database/repos/ai-template/ai-template.repo.ts` | Repository：CRUD + 查找 + 软删除，支持事务参数 |
| `apps/server/src/ee/ai/services/ai-template.service.ts` | Service：三层解析、懒加载种子、权限标记、全局提示词管理 |
| `apps/server/src/ee/ai/ai-template.controller.ts` | Controller：7 个端点，CASL 权限校验 |
| `apps/server/src/ee/ai/dto/ai-template.dto.ts` | DTOs：5 个验证类（Create/Update/Delete/Reset/SystemPrompt） |

### 前端（6 个）

| 文件 | 说明 |
|------|------|
| `apps/client/src/ee/ai/types/ai-template.types.ts` | TypeScript 接口（IAiTemplate + CRUD 请求类型） |
| `apps/client/src/ee/ai/services/ai-template-service.ts` | API 客户端（7 个函数，均通过 `.data` 解包） |
| `apps/client/src/ee/ai/queries/ai-template-query.ts` | TanStack Query hooks（7 个，含自动缓存失效） |
| `apps/client/src/ee/ai/components/ai-templates/ai-system-prompt-editor.tsx` | 全局系统提示词编辑器（Textarea + Save/Clear） |
| `apps/client/src/ee/ai/components/ai-templates/ai-template-editor.tsx` | 模板编辑 Modal（图标下拉选择、16 个 Tabler 图标枚举） |
| `apps/client/src/ee/ai/components/ai-templates/ai-template-list.tsx` | 管理员模板管理表格（Key/Name/Type/Actions） |

---

## 修改文件清单（共 9 个）

### 后端（5 个）

| 文件 | 修改内容 |
|------|---------|
| `apps/server/src/database/types/db.d.ts` | 新增 `AiPromptTemplates` 接口 + `DB` 注册 |
| `apps/server/src/database/types/entity.types.ts` | 新增 `AiPromptTemplate` / `Insertable` / `Updatable` 类型导出 |
| `apps/server/src/database/database.module.ts` | providers/exports 注册 `AiTemplateRepo` |
| `apps/server/src/ee/ai/ai.module.ts` | controllers 注册 `AiTemplateController`，providers 注册 `AiTemplateService` |
| `apps/server/src/ee/ai/ai.controller.ts` | `creatorGenerate` 方法改用三层模板解析 + 全局系统提示词拼接 |
| `apps/server/src/ee/ai/constants/ai-templates.ts` | `AiTemplate` 接口增加 `description`/`icon` 字段，6 个模板补全 |

### 前端（3 个）

| 文件 | 修改内容 |
|------|---------|
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx` | 模板菜单改用动态 API 数据，基于 `canEdit`/`canDelete` 权限标记显示编辑/删除按钮 |
| `apps/client/src/ee/ai/pages/ai-settings.tsx` | 管理员设置页新增系统提示词编辑器 + 模板管理表格 |
| `apps/client/src/features/workspace/types/workspace.types.ts` | `IWorkspaceAiSettings` 增加 `systemPrompt` 字段 |

---

## 前端组件结构

### AI Creator 面板 — 模板菜单

```
Menu.Dropdown
├── 模板列表（来自 useAiTemplatesQuery）
│   ├── 模板名 + 来源标记（"Personal" badge）
│   ├── [canReset] 重置按钮（IconRotate）
│   ├── [canEdit]  编辑按钮（IconEdit）
│   └── [canDelete] 删除按钮（IconTrash）
├── ── Divider ──
├── + 新建模板
└── 清除模板选择
```

### 管理员设置页

```
AI Settings
├── EnableAiSearch（非云版）
├── EnableGenerativeAi
├── ── Divider ──
├── AiSystemPromptEditor（全局系统提示词）
├── ── Divider ──
└── AiTemplateList（工作区模板管理表格）
    └── AiTemplateEditor（编辑/新建 Modal）
```

### 模板编辑器 Modal

字段：
- **Key** — slug 标识符，编辑模式下锁定
- **Name** — 显示名称
- **Description** — 简短描述
- **Icon** — Select 下拉选择（16 个预设图标，带图标预览）
- **Prompt** — 大文本区（系统提示词内容）

---

## 图标枚举

模板编辑器提供 16 个 `@tabler/icons-react` 图标供选择：

| 图标值 | 说明 |
|--------|------|
| `IconFileCode` | 代码文件 |
| `IconBook` | 书籍/手册 |
| `IconClipboardList` | 需求清单 |
| `IconChartBar` | 图表/报告 |
| `IconNotes` | 笔记 |
| `IconChecklist` | 检查清单 |
| `IconFileText` | 文本文件 |
| `IconBulb` | 创意/灵感 |
| `IconPresentation` | 演示 |
| `IconFileAnalytics` | 分析 |
| `IconWriting` | 写作 |
| `IconBriefcase` | 商务 |
| `IconCode` | 代码 |
| `IconSchool` | 教育 |
| `IconMessage` | 沟通 |
| `IconList` | 列表 |

---

## AI Creator 请求的提示词拼接顺序

```
1. 全局系统提示词（workspace.settings.ai.systemPrompt）
2. 模板提示词（三层解析：user → workspace → system 常量）
3. 续写上下文（insertMode='append' 时的页面摘要）
4. 用户输入的 prompt
```

---

## 内置模板（6 个种子）

| Key | 名称 | 图标 | 描述 |
|-----|------|------|------|
| `technical-doc` | 技术文档 | IconFileCode | 系统架构、API 文档 |
| `operation-manual` | 操作手册 | IconBook | 分步操作指南 |
| `meeting-notes` | 会议纪要 | IconNotes | 会议记录与决议 |
| `requirements` | 需求分析 | IconChecklist | 功能分解与验收标准 |
| `report` | 研究报告 | IconChartBar | 行业分析与研究 |
| `prd` | 产品 PRD | IconClipboardList | 产品需求规格书 |

---

## 向后兼容保障

1. **`AI_TEMPLATES` 常量保留** — 作为种子数据源和系统默认兜底，DB 无数据时自动回退
2. **`AI_TEMPLATE_OPTIONS` 常量保留** — 前端 React Query 加载失败时的静态回退
3. **API 签名不变** — `creatorGenerate` 仍接受 `template` key 参数，查找来源从常量变为三层解析
4. **数据库迁移安全** — 仅新增表，不修改现有表结构（systemPrompt 利用现有 JSONB）
5. **nullish coalescing 兜底** — Layer 2/3 的 `description`/`icon` 为 null 时自动回退到下层值

---

## 踩坑记录

### 1. TransformHttpResponseInterceptor 响应包装

**问题**：后端全局拦截器将所有响应包装为 `{ data: ..., success: true, status: 200 }`，前端 API 函数直接 `return api.post(...)` 导致拿到的是包装后的对象，`res.templates` 为 `undefined`。

**表现**：模板列表永远拿不到 → `dynamicTemplates` 始终为 `undefined` → 前端回退到静态模板 → 所有动态功能失效（编辑、创建、删除均无法反映在 UI）。

**修复**：所有 API 函数改为 `const req = await api.post(...); return req.data;`，与项目中 `workspace-service.ts` 等现有调用保持一致。

### 2. 三层覆盖时 null 值吞掉系统默认

**问题**：Layer 2（DB 工作区模板）覆盖 Layer 1（系统默认）时，DB 中旧种子的 `description` 和 `icon` 为 `null`，直接覆盖掉了系统默认的非空值。

**表现**：编辑模板时图标和描述字段为空，即使系统默认模板有这些值。

**修复**：Layer 2/3 解析时使用 `??`（nullish coalescing）：`description: t.description ?? prev?.description`，只有当 DB 值不为 null 时才覆盖。

### 3. 种子数据缺少 description/icon

**问题**：初始版本 `AI_TEMPLATES` 接口只有 `key/name/prompt`，种子数据和系统默认解析都不包含 `description`/`icon`。

**修复**：
- 后端 `AiTemplate` 接口增加 `description`/`icon` 字段
- 6 个模板常量补全这两个字段
- 种子插入和系统默认解析层同步包含
- 新增 backfill 逻辑：已有种子缺少这些字段时自动补充

### 4. 前端权限控制缺失

**问题**：初始版本模板菜单对所有用户显示相同的操作按钮（齿轮自定义），不区分管理员和普通用户。

**修复**：
- 后端 `getResolvedTemplates` 增加 `isAdmin` 参数，每个模板返回 `canEdit`/`canDelete` 权限标记
- 前端根据这两个标记条件渲染编辑/删除按钮
- 普通用户对默认模板不显示任何操作按钮
