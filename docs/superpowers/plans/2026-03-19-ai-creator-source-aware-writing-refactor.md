# AI Creator源码感知写作重构实施方案

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 消除重复的全部分重写和令牌浪费，将源文档图像保留为一流的可重用资产，并使图像/审查状态在代理服务、网关和工作台 UI 中具有确定性。

**架构：** 使用中间件优先、模型辅助的管道。上传的文件被标准化为结构化解析结果，其中包含文本资产、图像资产、出处和稳定的可重用 URL。作者为每个部分生成一份初始草稿，可以选择对同一草稿应用一种目标变换，并且仅在文本稳定后才具体化视觉效果。蓝图审查成为图像策略和源图批准的控制点，而运行时事件则公开提取、重用、降级和生成决策。

**技术栈：** FastAPI、Pydantic 模型、PydanticAI/OpenAI 兼容流、NestJS 网关、React、TypeScript、pytest、`node:test`、`tsx`、浏览器接受脚本

**工作树：** 从 `E:\test\Docmost\.worktrees\ai-creator-workbench` 执行此计划。下面的所有文件路径都是相对于该工作树根的。

---

## 范围和成功标准

- 默认 3 级写入流程将每个部分写入一次，并最多执行一次目标修改。
- 解析器从上传的 PDF 或其他支持的文件中提取的图像成为具有源出处和可重用 Docmost URL 的 `AssetItem(type="image")` 条目。
- 蓝图审查公开明确的图像策略和每个部分的源图像候选，而不是默默地依赖弱关键字重叠。
- 生成的图像仅在文本稳定后且仅在策略允许生成时创建。
- 当所需的源图形或所需的生成图形丢失时，审查/评估器逻辑块完成。
- 工作台 UI 显示源图像提取结果、视觉决策和降级状态。
- 回归、类型检查和浏览器接受涵盖源图像重用、优先重用回退和令牌控制行为。

## 护栏

- 保持当前会话和 API 负载向后兼容，同时引入更丰富的可选字段。
- 将旧映像策略（`reuse_source`、`mixed`、`generate_new`、`none`）标准化为一个规范的内部枚举，而不是破坏旧快照。
- 不要引入新的隐藏后台重试循环。
- 不要为相同的源资产或相同的部分提示生成或上传重复的图像。
- 与已经繁忙的模块中的大量重写相比，更喜欢附加模式更改和集中的帮助程序文件。

## 文件结构概述

### 新文件

- `agent-service/app/models/source_assets.py`
- `agent-service/app/tools/source_image_store.py`
- `agent-service/app/workers/section_revision.py`
- `agent-service/tests/workers/test_source_image_store.py`
- `apps/client/src/ee/ai/types/source-assets.types.ts`
- `apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.tsx`
- `apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx`
- `agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`

### 修改文件

- `agent-service/app/models/asset_map.py`
- `agent-service/app/models/blueprint.py`
- `agent-service/app/models/brief.py`
- `agent-service/app/schemas/response.py`
- `agent-service/app/workers/asset_parser.py`
- `agent-service/app/orchestrator/tools/parse_assets.py`
- `agent-service/app/tools/docling_parser.py`
- `agent-service/app/tools/docmost_api.py`
- `agent-service/app/workers/visual_planner.py`
- `agent-service/app/orchestrator/tools/create_brief.py`
- `agent-service/app/orchestrator/tools/create_blueprint.py`
- `agent-service/app/workers/section_writer.py`
- `agent-service/app/orchestrator/tools/write_tools.py`
- `agent-service/app/orchestrator/tools/rewrite_section.py`
- `agent-service/app/workers/evaluator.py`
- `agent-service/app/agent/events.py`
- `agent-service/app/runtime_logging.py`
- `agent-service/app/main.py`
- `apps/client/src/ee/ai/types/brief.types.ts`
- `apps/client/src/ee/ai/types/blueprint.types.ts`
- `apps/client/src/ee/ai/types/agent.types.ts`
- `apps/client/src/ee/ai/services/agent-service.ts`
- `apps/client/src/ee/ai/services/ai-create-runner.ts`
- `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- `apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx`
- `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- `apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx`
- `apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx`

---

## 分块 1：源素材合约与摄取

### 任务 1：保留 parser-extracted images as first-class assets

**文件：**
- 创建：`agent-service/app/models/source_assets.py`
- 修改：`agent-service/app/models/asset_map.py`
- 修改：`agent-service/app/workers/asset_parser.py`
- 修改：`agent-service/app/orchestrator/tools/parse_assets.py`
- 测试： `agent-service/tests/workers/test_asset_parser.py`
- 测试： `agent-service/tests/orchestrator/test_parse_assets.py`

- [ ] **第 1 步：编写失败的测试**
添加案例，证明解析器返回的 `images` 通过 `content_hash`、`source_page`、`source_heading`、`caption` 和 `origin="uploaded_source"` 变成 `AssetItem(type="image")`。

- [ ] **第 2 步：运行测试以验证失败**
运行： `python -m pytest agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py -q`
预期：失败，因为 `asset_parser.py` 当前丢弃解析器返回的图像。

- [ ] **第 3 步：实现解析结果合约**
使用 `SourceLocation`、`SourceImageAsset` 和 `DocumentParseResult` 创建 `source_assets.py`。使用可选的出处字段扩展 `AssetItem`，而不是破坏现有的 JSON。

- [ ] **第 4 步：通过摄取连接解析器输出**
更新 `parse_document()` 以读取 `result["text"]` 和 `result["images"]`，然后更新 `parse_assets_impl()`，使其不再依赖于入站 `file_info["images"]`。

- [ ] **第 5 步：重新运行测试**
运行： `python -m pytest agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py -q`
预期：通过。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/models/source_assets.py agent-service/app/models/asset_map.py agent-service/app/workers/asset_parser.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py
git commit -m "feat(agent-service): preserve extracted source images in asset ingestion"
```

### 任务 2：添加 source-image dedupe and rehosting

**文件：**
- 创建：`agent-service/app/tools/source_image_store.py`
- 修改：`agent-service/app/orchestrator/tools/parse_assets.py`
- 修改：`agent-service/app/tools/docmost_api.py`
- 测试： `agent-service/tests/workers/test_source_image_store.py`
- 测试： `agent-service/tests/orchestrator/test_parse_assets_parallel.py`

- [ ] **第 1 步：编写失败的测试**
添加案例，证明为同一页面上传两次的相同提取图像重复使用相同的存储 URL，并且并行解析不会重复上传。

- [ ] **第 2 步：运行测试以验证失败**
运行： `python -m pytest agent-service/tests/workers/test_source_image_store.py agent-service/tests/orchestrator/test_parse_assets_parallel.py -q`
预期：失败，因为尚不存在内容哈希缓存。

- [ ] **第 3 步：实现基于哈希的源图像存储**
在 `source_image_store.py` 中添加 `compute_image_hash()` 和 `ensure_source_image_uploaded()`，由 `page_id + content_hash` 键入，同时将实际上传 IO 保留在 `docmost_api.py` 中。

- [ ] **第 4 步：通过存储路由解析资产**
更新 `parse_assets_impl()` 以通过新商店上传提取的图像，并将稳定的 URL 和哈希值写回到每个 `AssetItem` 上。

- [ ] **第 5 步：重新运行测试**
运行： `python -m pytest agent-service/tests/workers/test_source_image_store.py agent-service/tests/orchestrator/test_parse_assets_parallel.py -q`
预期：通过。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/tools/source_image_store.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/tools/docmost_api.py agent-service/tests/workers/test_source_image_store.py agent-service/tests/orchestrator/test_parse_assets_parallel.py
git commit -m "feat(agent-service): dedupe and 重新托管 extracted source images"
```

## 分块 2：蓝图图片策略与候选绑定

### 任务 3：Canonicalize image policy and upgrade visual planning

**文件：**
- 修改：`agent-service/app/models/brief.py`
- 修改：`agent-service/app/models/blueprint.py`
- 修改：`agent-service/app/orchestrator/tools/create_brief.py`
- 修改：`agent-service/app/orchestrator/tools/create_blueprint.py`
- 修改：`agent-service/app/workers/visual_planner.py`
- 测试： `agent-service/tests/orchestrator/test_create_brief.py`
- 测试： `agent-service/tests/orchestrator/test_create_blueprint.py`
- 测试： `agent-service/tests/workers/test_visual_planner.py`

- [ ] **第 1 步：编写失败的测试**
添加规范策略的覆盖范围：
`reuse_source_only`, `prefer_source_then_generate`, `generate_new_only`, `none`.
还证明蓝图每部分的回报排名为 `visual_candidates`。

- [ ] **第 2 步：运行测试以验证失败**
运行： `python -m pytest agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/workers/test_visual_planner.py -q`
预期：失败，因为规划器仅进行关键字重叠，并且模型不公开候选列表。

- [ ] **步骤 3：实施规范的策略处理**
在模型验证边界标准化旧策略名称，以便旧会话继续工作。

- [ ] **第 4 步：用评分候选人取代单一获胜者计划**
根据标题相似性、图像摘要相似性、附近标题匹配、页面上下文关键字和 `must_cover` 重叠对候选者进行评分。在蓝图模型中保留候选列表和选定的视觉决策。

- [ ] **第 5 步：重新运行测试**
运行： `python -m pytest agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/workers/test_visual_planner.py -q`
预期：通过。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/models/brief.py agent-service/app/models/blueprint.py agent-service/app/orchestrator/tools/create_brief.py agent-service/app/orchestrator/tools/create_blueprint.py agent-service/app/workers/visual_planner.py agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/workers/test_visual_planner.py
git commit -m "feat(planning): add canonical image policy and scored source-image candidates"
```

### 任务 4：Expose source-image candidates in the workbench

**文件：**
- 创建：`apps/client/src/ee/ai/types/source-assets.types.ts`
- 创建：`apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx`
- 修改：`apps/client/src/ee/ai/types/brief.types.ts`
- 修改：`apps/client/src/ee/ai/types/blueprint.types.ts`
- 修改：`apps/client/src/ee/ai/types/agent.types.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx`
- 测试： `apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`

- [ ] **第 1 步：编写失败的 UI 测试**
添加测试，证明蓝图模式显示带有标题、源文件和页面提示的候选图像，并且用户可以将部分从生成图像模式切换到特定源图像。

- [ ] **第 2 步：运行测试以验证失败**
运行： `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
预期：失败，因为 UI 还不知道候选列表或规范策略。

- [ ] **第 3 步：添加焦点 UI 类型和选择器组件**
让 `source-assets.types.ts` 专注于候选元数据，并在 `BlueprintModal.tsx` 内使用 `SourceImageCandidates.tsx`，而不是在模态中嵌入所有候选渲染逻辑。

- [ ] **步骤 4：有线模式确认有效负载**
确保蓝图确认发送规范映像策略、每个部分选定的源映像候选 ID 以及明确的 `generate instead` 覆盖（如果适用）。

- [ ] **第 5 步：重新运行测试和类型检查**
运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`
预期：通过。

- [ ] **第 6 步：提交**

```bash
git add apps/client/src/ee/ai/types/source-assets.types.ts apps/client/src/ee/ai/types/brief.types.ts apps/client/src/ee/ai/types/blueprint.types.ts apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.tsx apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx
git commit -m "feat(client): add blueprint source-image review and canonical image policy UI"
```

## 分块 3：Writer 生命周期、Token 控制与图片落地

### 任务 5：合并 double retry into one initial draft plus one targeted revision

**文件：**
- 创建：`agent-service/app/workers/section_revision.py`
- 修改：`agent-service/app/workers/section_writer.py`
- 修改：`agent-service/app/orchestrator/tools/write_tools.py`
- 修改：`agent-service/app/orchestrator/tools/rewrite_section.py`
- 测试： `agent-service/tests/workers/test_section_writer.py`
- 测试： `agent-service/tests/orchestrator/test_write_tools.py`
- 测试： `agent-service/tests/orchestrator/test_rewrite_section.py`

- [ ] **第 1 步：编写失败的测试**
添加测试，证明正常路径调用一个部分草稿生成，而超出预算或低于预算的部分则对上一草稿使用一个目标转换，而不是全新的完全重写。

- [ ] **第 2 步：运行测试以验证失败**
运行： `python -m pytest agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py -q`
预期：失败，因为当前逻辑仍然由外部和内部重试组成。

- [ ] **第 3 步：实现新的写入生命周期**
职责划分，`section_writer.py` 拥有初始草案生成和流传输，`section_revision.py` 拥有 `condense` / `expand` / `restructure`，`write_tools.py` 决定是否需要进行有针对性的修订。将所有长度阈值逻辑保留在一个助手中。

- [ ] **第 4 步：重新运行测试**
运行： `python -m pytest agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/section_revision.py agent-service/app/workers/section_writer.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/orchestrator/tools/rewrite_section.py agent-service/tests/workers/test_section_writer.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py
git commit -m "refactor(writer): replace repeated full rewrites with targeted section revision"
```

### 任务 6：落地 visuals only after text is stable

**文件：**
- 修改：`agent-service/app/workers/section_writer.py`
- 修改：`agent-service/app/orchestrator/tools/write_tools.py`
- 修改：`agent-service/app/tools/source_image_store.py`
- 修改：`agent-service/app/tools/docmost_api.py`
- 测试： `agent-service/tests/workers/test_generate_section_visuals.py`
- 测试： `agent-service/tests/orchestrator/test_e2e_level3.py`

- [ ] **第 1 步：编写失败的测试**
添加测试，证明在文本接受之前不会调用 `generate_section_visuals()`，选择源图像不会触发 AI 生成，并且目标修订不会重复上传。

- [ ] **第 2 步：运行测试以验证失败**
运行： `python -m pytest agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/orchestrator/test_e2e_level3.py -q`
预期：失败，因为当前视觉效果生成得太早并且与写入重试相关。

- [ ] **第 3 步：实现两阶段视觉实体化**
让 `write_single_section()` 遵循：初始文本草稿、可选的有针对性的修改、选择批准的视觉决策、重复使用批准的源图像或生成一张新图像一次，然后发出最终的视觉状态。

- [ ] **第 4 步：重新运行测试**
运行： `python -m pytest agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/orchestrator/test_e2e_level3.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/section_writer.py agent-service/app/orchestrator/tools/write_tools.py agent-service/app/tools/source_image_store.py agent-service/app/tools/docmost_api.py agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/orchestrator/test_e2e_level3.py
git commit -m "refactor(writer): delay visual materialization until text is stable"
```

## 分块 4：评估、可观测性与降级状态暴露

### 任务 7：Make evaluator and review logic understand visual commitments

**文件：**
- 修改：`agent-service/app/workers/evaluator.py`
- 修改：`agent-service/app/orchestrator/tools/fix_tools.py`
- 修改：`agent-service/app/models/blueprint.py`
- 测试： `agent-service/tests/workers/test_evaluator.py`
- 测试： `agent-service/tests/orchestrator/test_e2e_review.py`

- [ ] **第 1 步：编写失败的测试**
如果没有插入批准的源图，添加案例证明 `reuse_source_only` 会阻止最终确定，并且 `prefer_source_then_generate` 仅在后备明确且可追踪时降级为警告。

- [ ] **第 2 步：运行测试以验证失败**
运行： `python -m pytest agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_e2e_review.py -q`
预期：失败，因为评估器当前仅检查广泛的视觉拦截器。

- [ ] **步骤 3：实施政策意识评估**
保留足够的蓝图元数据来比较请求的策略、批准的源图像候选 ID、实际插入的图形证据以及后备原因（如果使用生成）。

- [ ] **第 4 步：重新运行测试**
运行： `python -m pytest agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_e2e_review.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/evaluator.py agent-service/app/orchestrator/tools/fix_tools.py agent-service/app/models/blueprint.py agent-service/tests/workers/test_evaluator.py agent-service/tests/orchestrator/test_e2e_review.py
git commit -m "feat(review): enforce approved visual policy during evaluation and fixes"
```

### 任务 8：Surface write attempts, source-image status, and degraded states end to end

**文件：**
- 修改：`agent-service/app/agent/events.py`
- 修改：`agent-service/app/runtime_logging.py`
- 修改：`agent-service/app/main.py`
- 修改：`agent-service/app/schemas/response.py`
- 修改：`apps/client/src/ee/ai/services/agent-service.ts`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.ts`
- 修改：`apps/client/src/ee/ai/types/agent.types.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- 测试： `agent-service/tests/test_event_logging.py`
- 测试： `agent-service/tests/test_main.py`
- 测试： `apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- 测试： `apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`

- [ ] **第 1 步：编写失败的测试**
添加每个部分 `write_attempts` 的覆盖范围、提取/重用/生成/跳过的图像计数、降级原因和客户端快照规范化。

- [ ] **第 2 步：运行测试以验证失败**
运行：
- `python -m pytest agent-service/tests/test_event_logging.py agent-service/tests/test_main.py -q`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
预期：失败，因为当前事件和快照类型不公开这些详细信息。

- [ ] **第 3 步：实现结构化可观察性**
发出结构化事件以进行源图像提取、重用、生成后备和部分修订。通过会话快照显示聚合状态，以便 UI 可以显示徽章和块，而无需解析原始日志。

- [ ] **第 4 步：重新运行测试和类型检查**
运行：
- `python -m pytest agent-service/tests/test_event_logging.py agent-service/tests/test_main.py -q`
- `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/agent/events.py agent-service/app/runtime_logging.py agent-service/app/main.py agent-service/app/schemas/response.py apps/client/src/ee/ai/services/agent-service.ts apps/client/src/ee/ai/services/ai-create-runner.ts apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx apps/client/src/ee/ai/components/ai-creator/blocked/BlockedResolutionCard.tsx apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx agent-service/tests/test_event_logging.py agent-service/tests/test_main.py apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx
git commit -m "feat(observability): expose visual lifecycle and write-attempt state end to end"
```

## 分块 5：端到端验收与发布

### 任务 9：Extend browser acceptance to cover source-image reuse and fallback paths

**文件：**
- 创建：`agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- 修改：`agent-service/tests/browser_ai_creator_smoke.py`
- 修改：`agent-service/tests/browser_ai_creator_agent_outline_e2e.py`
- 修改：`agent-service/tests/playwright_ai_creator_utils.py`

- [ ] **第 1 步：编写或更新浏览器场景**
使用可重复使用的图形覆盖 PDF 上传、`reuse_source_only` 插入、`prefer_source_then_generate` 后备，并且修改或恢复后没有重复的图像。

- [ ] **第 2 步：运行浏览器套件并捕获失败**
运行：
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
预期：失败，直到出现新的 UI 和会话状态行为。

- [ ] **步骤 3：仅在较低级别的测试通过后修复接受差距**
不要围绕损坏的行为修补浏览器测试。首先修复底层合约或 UI 行为。

- [ ] **第 4 步：重新运行浏览器接受**
运行：
- `python agent-service/tests/browser_ai_creator_smoke.py`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
- `python agent-service/tests/browser_ai_creator_insert_e2e.py`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py agent-service/tests/browser_ai_creator_smoke.py agent-service/tests/browser_ai_creator_agent_outline_e2e.py agent-service/tests/playwright_ai_creator_utils.py
git commit -m "test(browser): cover source-image reuse and fallback acceptance flows"
```

### 任务 10：运行 the full verification matrix and update docs

**文件：**
- 修改：`docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md`
- 修改：`docs/superpowers/plans/2026-03-14-ai-creator-phase2-assets-planning.md`
- 修改：`docs/superpowers/plans/2026-03-14-ai-creator-phase3-section-writer.md`
- 修改：`docs/superpowers/plans/2026-03-14-ai-creator-phase4-review-system.md`

- [ ] **第 1 步：更新规范和阶段文档**
记录规范的图像策略名称、中间件优先的源图像摄取、单次写入加目标修订生命周期、文本后视觉具体化和策略感知评估。

- [ ] **第 2 步：运行后端验证矩阵**
运行：
`python -m pytest agent-service/tests/orchestrator/test_create_brief.py agent-service/tests/orchestrator/test_create_blueprint.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_parallel.py agent-service/tests/orchestrator/test_write_tools.py agent-service/tests/orchestrator/test_rewrite_section.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/orchestrator/test_e2e_review.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/workers/test_visual_planner.py agent-service/tests/workers/test_section_writer.py agent-service/tests/workers/test_generate_section_visuals.py agent-service/tests/workers/test_evaluator.py agent-service/tests/test_event_logging.py agent-service/tests/test_main.py -q`
预期：通过。

- [ ] **第 3 步：运行前端验证矩阵**
运行：
- `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/blueprint/SourceImageCandidates.test.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-workbench.test.tsx apps/client/src/ee/ai/services/ai-create-runner.test.ts`
- `pnpm --filter ./apps/client exec tsc --noEmit --pretty false`
- `pnpm --filter ./apps/server exec tsc --noEmit --pretty false`
预期：通过。

- [ ] **步骤 4：检查工作树状态并创建最终集成提交**
运行：
- `git status --short --branch`
- `git add docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md docs/superpowers/plans/2026-03-14-ai-creator-phase2-assets-planning.md docs/superpowers/plans/2026-03-14-ai-creator-phase3-section-writer.md docs/superpowers/plans/2026-03-14-ai-creator-phase4-review-system.md`
- `git commit -m "docs: align AI Creator spec and phase plans with source-aware writing refactor"`

- [ ] **第 5 步：准备推出说明**
记录任何临时向后兼容规范化、任何仍需要 PDF 转换的文件格式，以及任何剩余的成本/使用仪表板工作，这些工作将推迟到此重构之后。

## 推迟的后续工作

- 当图形保真度很重要时，在多模式解析之前添加可选的服务器端 `.docx` 和 `.pptx` 到 PDF 的转换。
- 添加语义图形嵌入，以便在弱标记的屏幕截图中更好地检索候选者。
- 添加工作区级 AI 使用仪表板和每次运行成本摘要，类似于 Coda 风格的治理。
- 如果产品进一步走向可见的逐步编辑，则添加明确的面向用户的 `regenerate section` 和 `accept/reject revision` 控件。
