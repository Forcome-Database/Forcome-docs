#参考-First Agent第一阶段实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 交付最小的可靠行为更改，使 AI Creator 首先读取所需的来源，在所需证据失败时停止，并避免在证据收集之前进行不必要的澄清。

**架构：** 添加一个权威的证据预检层，将 URL/上传的文档/上传的图像/页面上下文统一为证据项，在下游生成之前强制执行硬运行时门控，并仅公开最少的用户可见状态。在此阶段不要解决提案/大纲/审稿人的复杂性。

**技术栈：** React/TypeScript 客户端、NestJS 服务器、Python/FastAPI 代理服务、LangGraph、Jest/TSX 测试、Pytest。

---

## 文件结构

### 服务器权限

- 创建：`apps/server/src/ee/ai/evidence-preflight.ts`
  - 提取 URL、对所需证据进行分类、得出是否需要搜索以及规范上传源要求。
- 创建：`apps/server/src/ee/ai/evidence-preflight.spec.ts`
  - 涵盖 URL 提取、上传文档/图像要求以及搜索所需检测。
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
  - 使用服务器端证据预检并转发标准化证据集。
- 修改：`apps/server/src/ee/ai/document-strategy.ts`
  - 仅添加证据优先执行所需的最小路由/策略扩展。

### 客户端传输和用户体验

- 修改：`apps/client/src/ee/ai/services/agent-service.ts`
  - 转发原始上传/页面信号并接受阻止的事件。
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
  - 规范被阻止的事件。
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.test.ts`
  - 覆盖阻塞事件标准化。
- 修改：`apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
  - 阻塞时停止，阻止自动进展，并显示失败。
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
  - 仅显示最少的状态。
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
  - 清晰地呈现阻止/读取/搜索状态。

### 代理运行时

- 修改：`agent-service/app/schemas/request.py`
  - 接受来自服务器的最小证据集。
- 创建：`agent-service/app/agent/evidence.py`
  - 定义最小证据项助手。
- 修改：`agent-service/app/agent/state.py`
  - 添加证据项和阻止原因。
- 修改：`agent-service/app/main.py`
  - 播种初始证据状态。
- 创建：`agent-service/app/agent/nodes/evidence_acquirer.py`
  - 读取 URL、解析上传的文档、理解上传的图像、读取页面上下文、运行所需的搜索。
- 创建：`agent-service/app/agent/nodes/evidence_gate.py`
  - 如果任何所需的证据失败/超时，则阻止。
- 修改：`agent-service/app/agent/graph.py`
  - 在任何用户可见的生成步骤之前运行证据采集/门。
- 修改：`agent-service/app/agent/nodes/clarifier.py`
  - 仅在收集证据后将澄清视为后备措施。

### Tests

- 创建：`agent-service/tests/test_evidence_preflight_flow.py`
  - 核心证据优先的运行时案例。
- 创建或修改：`agent-service/tests/browser_ai_creator_reference_first.py`
  - 端到端检查读/写前搜索和故障停止行为。

## 分块 1：权威证据预检

### 任务 1：构建唯一权威的服务端证据预检

**文件：**
- 创建：`apps/server/src/ee/ai/evidence-preflight.ts`
- 测试： `apps/server/src/ee/ai/evidence-preflight.spec.ts`
- 修改：`apps/server/src/ee/ai/document-strategy.ts`

- [ ] **第 1 步：编写用于证据推导的失败测试**

```ts
it("marks a referenced URL as required evidence", () => {
  const result = buildEvidencePreflight({
    prompt: "参照 https://example.com/docs 写一份指南",
    files: [],
    pageContent: "",
  });

  expect(result.items).toContainEqual(
    expect.objectContaining({
      kind: "reference_url",
      source: "https://example.com/docs",
      required: true,
    }),
  );
});

it("marks an uploaded PDF as required evidence when the task depends on it", () => {
  const result = buildEvidencePreflight({
    prompt: "根据我上传的 PDF 写操作手册",
    files: [{ filename: "manual.pdf", mimetype: "application/pdf" }],
    pageContent: "",
  });

  expect(result.items).toContainEqual(
    expect.objectContaining({
      kind: "uploaded_document",
      source: "manual.pdf",
      required: true,
    }),
  );
});
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts`

预期：失败，因为预检助手尚不存在。

- [ ] **第 3 步：实施最少证据预检**

```ts
type EvidenceKind =
  | "reference_url"
  | "uploaded_document"
  | "uploaded_image"
  | "page_context"
  | "web_search";
```

- [ ] **第 4 步：运行测试以验证其通过**

运行： `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts`

预期：URL、上传和搜索所需分类通过。

- [ ] **第 5 步：提交**

```bash
git add apps/server/src/ee/ai/evidence-preflight.ts apps/server/src/ee/ai/evidence-preflight.spec.ts apps/server/src/ee/ai/document-strategy.ts
git commit -m "feat: add authoritative AI evidence preflight"
```

### 任务 2：将证据预检结果转发到 agent-service

**文件：**
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- 修改：`apps/client/src/ee/ai/services/agent-service.ts`
- 测试： `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

- [ ] **第 1 步：编写失败的网关测试**

```ts
expect(agentBody).toMatchObject({
  evidence_items: expect.any(Array),
});
```

- [ ] **第 2 步：运行测试以验证其是否失败**

运行： `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

预期：失败，因为网关尚未发送证据集。

- [ ] **步骤 3：实现具有可选字段兼容性的转发**

```ts
const evidence = buildEvidencePreflight(...);
const agentBody = {
  ...existing,
  evidence_items: evidence.items,
};
```

- [ ] **第 4 步：运行测试以验证其通过**

运行： `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts src/ee/ai/evidence-preflight.spec.ts`

预期：通过并转发标准化证据。

- [ ] **第 5 步：提交**

```bash
git add apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts apps/client/src/ee/ai/services/agent-service.ts
git commit -m "feat: forward AI evidence set to agent runtime"
```

## 分块 2：运行时硬门控

### 任务 3：向 agent-service 添加最小证据状态

**文件：**
- 修改：`agent-service/app/schemas/request.py`
- 创建：`agent-service/app/agent/evidence.py`
- 修改：`agent-service/app/agent/state.py`
- 修改：`agent-service/app/main.py`
- 测试： `agent-service/tests/test_evidence_preflight_flow.py`

- [ ] **第 1 步：为证据项目编写失败的 pytest 覆盖范围**

```python
def test_request_accepts_evidence_items():
    req = AgentRunRequest(
        user_message="use this",
        evidence_items=[
            {
                "kind": "reference_url",
                "source": "https://example.com",
                "required": True,
                "status": "pending",
                "purpose": "primary source",
            }
        ],
    )
    assert req.evidence_items[0].kind == "reference_url"
```

- [ ] **第 2 步：运行测试以验证其是否失败**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：失败，因为请求/状态模型尚不支持证据项。

- [ ] **第 3 步：实施最低限度的证据项目支持**

```python
class EvidenceItem(TypedDict):
    kind: str
    source: str
    required: bool
    status: str
    purpose: str
    error: str | None
```

- [ ] **第 4 步：运行测试以验证其通过**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：通过种子证据状态。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/schemas/request.py agent-service/app/agent/evidence.py agent-service/app/agent/state.py agent-service/app/main.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "feat: add minimal AI evidence state"
```

### 任务 4：在任何用户可见生成前获取必需证据

**文件：**
- 创建：`agent-service/app/agent/nodes/evidence_acquirer.py`
- 修改：`agent-service/app/agent/graph.py`
- 测试： `agent-service/tests/test_evidence_preflight_flow.py`

- [ ] **第 1 步：为所需的证据获取编写失败测试**

```python
def test_reference_url_is_read_before_generation():
    ...

def test_uploaded_document_is_parsed_before_generation():
    ...

def test_uploaded_image_is_understood_before_generation():
    ...
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：失败，因为证据获取尚不存在。

- [ ] **步骤 3：实施确定性证据获取**

```python
if item["kind"] == "reference_url":
    ...
elif item["kind"] == "uploaded_document":
    ...
elif item["kind"] == "uploaded_image":
    ...
```

- [ ] **第 4 步：运行测试以验证其通过**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：通过读取/解析/生成前视觉行为。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/agent/nodes/evidence_acquirer.py agent-service/app/agent/graph.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "feat: acquire required evidence before generation"
```

### 任务 5：添加硬失败停止门控

**文件：**
- 创建：`agent-service/app/agent/nodes/evidence_gate.py`
- 修改：`agent-service/app/agent/graph.py`
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.utils.ts`
- 修改：`apps/client/src/ee/ai/hooks/use-ai-create-session.ts`
- 测试： `agent-service/tests/test_evidence_preflight_flow.py`
- 测试： `apps/client/src/ee/ai/services/ai-create-runner.test.ts`

- [ ] **第 1 步：为阻止的行为编写失败测试**

```python
def test_required_evidence_failure_blocks_before_write():
    ...

def test_required_evidence_timeout_blocks_before_write():
    ...
```

```ts
assert.deepEqual(normalizeAgentRunEvent({ type: "blocked", message: "fetch failed" }), {
  type: "blocked",
  message: "fetch failed",
});
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

运行： `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`

预期：失败，因为硬阻止行为尚不存在。

- [ ] **第 3 步：实现运行时阻塞不变式**

```python
if any(item["required"] and item["status"] != "success" for item in evidence_items):
    return {"phase": "blocked", "blocked_reason": "..."}
```

- [ ] **步骤 4：确保阻塞到达客户端并停止会话**

```ts
case "blocked":
  setIsStreaming(false);
```

- [ ] **第 5 步：运行测试以验证其通过**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

运行： `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts`

预期：具有硬停止语义的 PASS。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/agent/nodes/evidence_gate.py agent-service/app/agent/graph.py apps/client/src/ee/ai/services/ai-create-runner.utils.ts apps/client/src/ee/ai/hooks/use-ai-create-session.ts agent-service/tests/test_evidence_preflight_flow.py apps/client/src/ee/ai/services/ai-create-runner.test.ts
git commit -m "feat: hard stop AI runs when required evidence fails"
```

## 分块 3：澄清作为兜底而非阶段

### 任务 6：仅在证据之后仍有具体决策阻塞执行时才提问

**文件：**
- 修改：`agent-service/app/agent/nodes/clarifier.py`
- 测试： `agent-service/tests/test_evidence_preflight_flow.py`

- [ ] **第 1 步：编写失败的测试**

```python
def test_clear_evidence_grounded_request_does_not_clarify():
    ...

def test_post_evidence_ambiguity_triggers_single_clarification():
    ...
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：失败，因为尚未以这种方式限制澄清。

- [ ] **第 3 步：实施仅后备澄清**

```python
if not missing_decision:
    return {"phase": "writer"}
```

- [ ] **第 4 步：运行测试以验证其通过**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：通过，证据前后没有不必要的问题。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/agent/nodes/clarifier.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "feat: treat clarification as fallback after evidence"
```

## 分块 4：最小化 UX 与 E2E

### 任务 7：将可见状态收敛为有意义的证据优先反馈

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`

- [ ] **第 1 步：编写失败的 UI 测试或集中断言**

```ts
expect(renderedText).toContain("reading sources");
expect(renderedText).not.toContain("proposal");
```

- [ ] **第 2 步：运行测试以验证其是否失败**

运行： `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts`

预期：失败，因为最小状态映射尚不存在。

- [ ] **第 3 步：实现最小可见状态**

```ts
const visibleStates = ["reading sources", "searching", "need clarification", "blocked", "writing"];
```

- [ ] **第 4 步：运行测试以验证其通过**

运行： `pnpm exec tsx --test apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts`

预期：通过低仪式状态渲染。

- [ ] **第 5 步：提交**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts
git commit -m "feat: simplify AI creator visible run states"
```

### 任务 8：为真实用户痛点补充端到端回归

**文件：**
- 创建或修改：`agent-service/tests/browser_ai_creator_reference_first.py`

- [ ] **第 1 步：编写失败的浏览器场景**

```python
def test_url_prompt_reads_before_write():
    ...

def test_required_fetch_failure_stops_without_draft():
    ...

def test_uploaded_pdf_is_parsed_before_write():
    ...

def test_uploaded_image_is_understood_before_write():
    ...
```

- [ ] **第 2 步：运行浏览器测试以验证它们是否失败**

运行： `python agent-service/tests/browser_ai_creator_reference_first.py`

预期：失败，因为当前运行时仍然允许过早生成。

- [ ] **第 3 步：仅实现所需的最少断言**

```python
assert "reading sources" in steps_text
assert "writing" not in steps_text_before_successful_evidence
```

- [ ] **第 4 步：运行浏览器和重点运行时测试**

运行： `python agent-service/tests/browser_ai_creator_reference_first.py`

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：读取/写入前搜索和故障停止行为通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/tests/browser_ai_creator_reference_first.py agent-service/tests/test_evidence_preflight_flow.py
git commit -m "test: add evidence-first AI creator regressions"
```

## 最终验证

- [ ] **第 1 步：运行重点服务器测试**

运行： `pnpm --filter ./apps/server exec jest --runInBand src/ee/ai/evidence-preflight.spec.ts src/ee/ai/agent-gateway/agent-gateway.controller.spec.ts`

预期：通过

- [ ] **第 2 步：运行重点客户端测试**

运行： `pnpm exec tsx --test apps/client/src/ee/ai/services/ai-create-runner.test.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.test.ts`

预期：通过

- [ ] **第 3 步：运行重点代理测试**

运行： `python -m pytest agent-service/tests/test_evidence_preflight_flow.py -q`

预期：通过

- [ ] **第 4 步：运行浏览器回归**

运行： `python agent-service/tests/browser_ai_creator_reference_first.py`

预期：通过

- [ ] **步骤 5：更新规划工件并提交修订后的计划**

```bash
git add docs/superpowers/specs/2026-03-13-reference-first-agent-design.md docs/superpowers/plans/2026-03-13-reference-first-agent-implementation.md findings.md progress.md
git commit -m "docs: revise reference-first AI creator phase 1 plan"
```
