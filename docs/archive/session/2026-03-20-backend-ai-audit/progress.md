# 进展

## 2026-03-20
- 将规划文件从之前的前端审核切换到当前的后端AI审核。
- 确认的目标目录和列出的候选实现文件。
- 在深入研究 `agent-service` 之前开始跟踪服务器端入口点。
- 确认了传统 `/ai/creator/generate` 和精心策划的 `/agent/run` / `/agent/resume` 之间的划分。
- 确认`OrchestratorEngine`是一个共享核心，但只有一些意图/路线实际上到达了结构化部分写入路径。
- 通过 `PageService.commitAiContent(...)` 和协作/Yjs 应用逻辑验证提交/回写路径。
- 验证当前的“优化”行为是路由/意图约定（`document_transform`），而不是专用后端端点。
- 验证了多个架构不匹配：代理路径丢失`scope/sourcePolicy/lengthPolicy`；当前页面转换不会成为结构化资产；多个死模块保留在带有测试的树中，但没有运行时调用者。

## 2026-03-20 外部研究会
- 开始外部研究，重点关注人择代理模式和文档编写/重写产品实践。
- 通过附加单独的研究部分来重用现有的计划文件，而不是重置当前的后端审计注释。
- 收集了 Anthropic、Microsoft Word/Copilot、Notion、BlockNote 和 Tiptap 的官方材料。
- 在 discovery.md 中记录工作流与代理边界、接受/拒绝/审查机制、显式上下文范围、权限/撤消约束、选择意识、流式传输和差异/审查模式的证据。
- 下一步：将外部验证的模式映射到 Docmost AI Creator 的 `selection rewrite`、`document transform` 和 `blank-page drafting` 场景，并在最终摘要中将事实与推论分开。

## 2026-03-20 重新设计规划会议
- 将批准的重新设计规范写入`docs/superpowers/specs/2026-03-20-ai-creator-document-task-redesign.md`。
- 将实施计划写入`docs/superpowers/plans/2026-03-20-ai-creator-document-task-redesign-implementation.md`。
- 为合约 shell、客户端 UI/状态切换、文档任务引擎、保存解析、差异/应用/回滚和迁移清理添加了分阶段任务。
- 在计划审查反馈后修改了实施计划，以涵盖源范围默认值、专用内联重写 API、空白页/多文档工作流程任务、深度协作失控以及缺少验证套件。

## 2026-03-21 块 1 执行
- 根据重新设计规范、实施计划和当前工作树状态重新验证块 1 范围。
- 已确认的任务 1 合同更改已针对客户意图映射、Nest 策略/计划帮助程序和代理服务协议模式进行到位。
- 已确认的任务 2 添加了文档任务 API shell（`/ai/document-tasks` 以及计划/差异/审查/应用/回滚/协作端点），同时保持旧网关兼容性接线。
- 已确认的任务 2A 添加了专用内联重写 API (`/ai/inline/rewrite`)，并将内联重写与文档任务状态/历史记录分开。
- 重新运行 分块 1 验证命令并获得客户端、服务器和代理服务测试套件的绿色结果。
- 停止在第 1 块验证和范围审查；这一关并没有刻意推进Chunk 2-4。

## 2026-03-22 实时验证和 UI 对齐
- 重新验证了无头浏览器中真实的当前页面严格保留流程：`/api/ai/document-tasks` 返回 `201`，`/api/agent/run` 流式传输 `simple_edit -> finalize -> done`，`/apply` 返回 `201`，`/rollback` 返回 `201`，页面 Markdown 恢复到原始快照。
- 使用 ASCII 命名的 PDF 固定装置重新验证真实的上传文档流，以避免 Playwright 路径编码漏报：shell 请求发送多部分表单数据，包括上传的 PDF 有效负载，并保留在严格保存的 `simple_edit -> finalize` 路径上，而不会回退到简短生成。
- 发现并修复了一个意图路由错误，其中诸如 `Do not use the current page` 之类的提示仍然触发 `uploaded_plus_current_page`；首先添加了失败的回归测试，然后更新了 `resolveAiIntent(...)` 以将显式当前页面排除短语视为选择退出信号。
- 在不更改状态合同的情况下改进了文档任务面板演示：更强大的标题层次结构、更清晰的最新步骤重点、时间线式活动提要、更清晰的差异/审查和待更改部分以及本地化的默认专家协作操作标签。
- 在最新更改后重新运行客户端、服务器和代理服务验证套件，并使所有目标套件保持绿色。
