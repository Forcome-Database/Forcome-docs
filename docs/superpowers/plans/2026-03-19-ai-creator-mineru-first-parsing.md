# MinerU-First解析实施方案

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 首先通过 MinerU 路由支持的上传文档，以便 PDF/Office 源图像、布局块和更丰富的文档结构成为 AI Creator 的一流 `AssetMap` 输入，同时保留 Docling 作为后备解析器。

**架构：** 添加 MinerU API 客户端和结果到 `DocumentParseResult` 适配器，然后通过 `MinerU-first / Docling-fallback` 路由在 `parse_assets_tool()` 中引入解析器选择。通过将标题/块/布局元数据映射到现有的 `AssetMap` / `source_structure` 合约中，将 MinerU 结构保留为一流输入，因此摘要/蓝图/编写器可以重用源结构，而不是将所有内容扁平化为纯文本。保留 Docling 仅作为不支持的格式或 MinerU 故障的后备方案。

**技术栈：** Python 3.11、FastAPI 代理服务、httpx、zipfile/json 解析、Pydantic 模型、pytest、现有 Docmost 上传/重新托管管道。

---

## 文件映射

### 新文件
- `agent-service/app/tools/mineru_client.py`
- `agent-service/app/workers/mineru_parser.py`
- `agent-service/tests/tools/test_mineru_client.py`
- `agent-service/tests/workers/test_mineru_parser.py`
- `agent-service/tests/orchestrator/test_parse_assets_mineru.py`

### 修改文件
- `agent-service/app/models/source_assets.py`
- `agent-service/app/workers/asset_parser.py`
- `agent-service/app/orchestrator/tools/parse_assets.py`
- `agent-service/app/orchestrator/engine.py`
- `agent-service/app/tools/docling_parser.py`
- `agent-service/app/tools/source_image_store.py`
- `agent-service/tests/workers/test_asset_parser.py`
- `agent-service/tests/orchestrator/test_engine.py`
- `agent-service/tests/orchestrator/test_e2e_level2.py`
- `.worktrees/ai-creator-workbench/.env`
- `.env.example`

### 要保留的现有边界
- `AssetMap` 仍然是编排器、规划器、评估器和写入器使用的唯一解析器输出。
- `upgrade_source_image_assets()` 仍然负责将源图像重新托管到稳定的 Docmost URL 中。
- `visual_planner.py` 和 `section_writer.py` 不得成为特定于解析器的。

## 当前功能和差距

### 当前功能
- `parse_assets_tool()` 当前通过同一同步 `parse_document()` 工作程序解析每个上传的文件，并合并生成的 `AssetMap`。
- `asset_parser.parse_document()` 目前采用 Doclling 形状的 `DocumentParseResult` 并将源扁平化为：
  - `heading_structure`
  - `text`
  - `table`
  - `code`
  - `mermaid`
  - `image`
- `create_brief.py` 已消耗 `source_word_count`、资产计数和标题摘要。
- `create_blueprint.py` 已经支持 `copy_source` 结构提示和源图像候选。
- `visual_planner.py` 已使用元数据重叠对源图像进行排名。
- `section_writer.py` 已经知道如何保留源材料、插入源图像 URL 以及发出资产标记。

### 目前的缺点
- 解析器层是特定于Docling的，并且在规划开始之前丢失布局丰富的元数据。
- 结构保存依赖于Markdown 标题恢复，这比真正的解析器块树弱。
- PDF 路径可以生成没有实际图像资源的 `<!-- image -->` 占位符，这会阻止源图像重用并在 `simple_edit` 路径上保留单文件转换。
- `simple_edit` 对于结构保留转换来说仍然过于以文本为中心；每当值得信赖的解析器返回可用的源结构和图像时，系统应该更喜欢结构化写入。

### 所需的 MinerU 集成立场
- 只要输入格式支持 MinerU，就首选 MinerU。
- 在规划和写作中直接重复使用 MinerU 标题/块/布局信息。
- 仅当 MinerU 不受支持、不可用或返回不可用的输出时才使用 Dobling。

## 分块 1：MinerU API 客户端

### 任务 1：添加 environment-driven MinerU client configuration

**文件：**
- 创建：`agent-service/app/tools/mineru_client.py`
- 修改：`.env.example`
- 修改：`.worktrees/ai-creator-workbench/.env`
- 测试： `agent-service/tests/tools/test_mineru_client.py`

- [ ] **第 1 步：编写配置加载失败的测试**

```python
from app.tools.mineru_client import MinerUConfig


def test_mineru_config_reads_env(monkeypatch):
    monkeypatch.setenv("MINERU_ENABLED", "true")
    monkeypatch.setenv("MINERU_API_BASE_URL", "https://mineru.net")
    monkeypatch.setenv("MINERU_API_TOKEN", "secret")

    config = MinerUConfig.from_env()

    assert config.enabled is True
    assert config.base_url == "https://mineru.net"
    assert config.token == "secret"
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/tools/test_mineru_client.py -k config -q`
预期：失败，因为 `MinerUConfig` 尚不存在。

- [ ] **第 3 步：实施最小配置模型**

```python
@dataclass(slots=True)
class MinerUConfig:
    enabled: bool
    base_url: str
    token: str
    poll_interval_seconds: float
    poll_timeout_seconds: float

    @classmethod
    def from_env(cls) -> "MinerUConfig":
        ...
```

- [ ] **第 4 步：重新运行测试**

运行： `python -m pytest agent-service/tests/tools/test_mineru_client.py -k config -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/tools/mineru_client.py agent-service/tests/tools/test_mineru_client.py .env.example .worktrees/ai-creator-workbench/.env
git commit -m "feat: add mineru client configuration"
```

### 任务 2：实现 upload + polling workflow

**文件：**
- 修改：`agent-service/app/tools/mineru_client.py`
- 测试： `agent-service/tests/tools/test_mineru_client.py`

- [ ] **第 1 步：为批量上传流程编写失败测试**

```python
@pytest.mark.asyncio
async def test_submit_file_for_extraction_uploads_and_polls(httpx_mock):
    client = MinerUClient(config=MinerUConfig(...))
    httpx_mock.add_response(
        method="POST",
        url="https://mineru.net/api/v4/file-urls/batch",
        json={"code": 0, "data": {"batch_id": "b1", "files": {"demo.pdf": "https://upload"}}},
    )
    httpx_mock.add_response(method="PUT", url="https://upload", status_code=200)
    httpx_mock.add_response(
        method="GET",
        url="https://mineru.net/api/v4/extract-results/batch/b1",
        json={"code": 0, "data": {"extract_result": [{"state": "done", "full_zip_url": "https://zip"}]}},
    )
    httpx_mock.add_response(method="GET", url="https://zip", content=b"PK...")

    result = await client.extract_file(name="demo.pdf", content=b"%PDF")

    assert result.batch_id == "b1"
    assert result.zip_bytes.startswith(b"PK")
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/tools/test_mineru_client.py -k upload -q`
预期：失败，因为 `MinerUClient.extract_file()` 未实现。

- [ ] **第 3 步：实现客户端方法**

```python
class MinerUClient:
    async def request_upload_urls(...): ...
    async def upload_to_presigned_url(...): ...
    async def poll_batch_result(...): ...
    async def download_zip(...): ...
    async def extract_file(...): ...
```

- [ ] **第 4 步：重新运行重点测试**

运行： `python -m pytest agent-service/tests/tools/test_mineru_client.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/tools/mineru_client.py agent-service/tests/tools/test_mineru_client.py
git commit -m "feat: add mineru upload and polling client"
```

## 分块 2：MinerU 结果适配器

### 任务 3：Extend parse result metadata for layout-aware source images

**文件：**
- 修改：`agent-service/app/models/source_assets.py`
- 测试： `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **第 1 步：编写图像负载元数据的失败测试**

```python
from app.models.source_assets import SourceImagePayload


def test_source_image_payload_supports_bbox_and_nearby_text():
    payload = SourceImagePayload(
        index=1,
        b64="abc",
        desc="Purchase return flow screenshot",
        page_number=2,
        heading="采购退货单（新增）",
        bbox=[10, 20, 300, 500],
        nearby_text="步骤 3：采购退货单（新增）",
        confidence=0.91,
        parser="mineru",
    )

    assert payload.page_number == 2
    assert payload.bbox == [10, 20, 300, 500]
    assert payload.parser == "mineru"
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k payload -q`
预期：失败，因为这些字段尚不存在。

- [ ] **第 3 步：将字段添加到 `SourceImagePayload`**

```python
bbox: list[float] = Field(default_factory=list)
nearby_text: str = ""
confidence: float = 0.0
parser: str = "docling"
is_fallback: bool = False
```

- [ ] **第 4 步：重新运行重点测试**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k payload -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/models/source_assets.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: extend source image payload metadata"
```

### 任务 4：Parse MinerU ZIP output into `DocumentParseResult`

**文件：**
- 创建：`agent-service/app/workers/mineru_parser.py`
- 测试： `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **第 1 步：编写 `full.md + content_list.json` 解析的失败测试**

```python
def test_parse_mineru_zip_extracts_text_and_images(sample_mineru_zip_bytes):
    result = parse_mineru_zip(sample_mineru_zip_bytes, filename="demo.pdf")

    assert "采购退货单 SOP" in result.text
    assert len(result.images) == 2
    assert result.images[0].page_number == 1
    assert "流程截图" in result.images[0].desc
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k parse_mineru_zip -q`
预期：失败，因为解析器尚不存在。

- [ ] **第 3 步：实施 `parse_mineru_zip()`**

```python
def parse_mineru_zip(zip_bytes: bytes, filename: str) -> DocumentParseResult:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        ...
        return DocumentParseResult(text=text, images=images)
```

- [ ] **第 4 步：重新运行测试**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/mineru_parser.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: parse mineru zip results into document assets"
```

### 任务 5：保留 MinerU structure instead of flattening it away

**文件：**
- 修改：`agent-service/app/models/source_assets.py`
- 修改：`agent-service/app/workers/mineru_parser.py`
- 修改：`agent-service/app/workers/asset_parser.py`
- 测试： `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **第 1 步：编写结构保留转换的失败测试**

```python
def test_parse_mineru_zip_preserves_heading_tree_and_block_order(sample_mineru_zip_bytes):
    result = parse_mineru_zip(sample_mineru_zip_bytes, filename="demo.pdf")

    assert result.structure[0]["text"] == "采购退货单 SOP"
    assert result.blocks[0]["type"] == "heading"
    assert result.blocks[1]["type"] == "text"
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k structure -q`
预期：失败，因为 `DocumentParseResult` 尚未保留结构。

- [ ] **第 3 步：添加最小结构字段**

```python
class DocumentParseResult(BaseModel):
    text: str = ""
    images: list[SourceImagePayload] = Field(default_factory=list)
    structure: list[dict] = Field(default_factory=list)
    blocks: list[dict] = Field(default_factory=list)
```

从 MinerU 输出填充这些并将它们转换为 `AssetMap.source_structure` 和有序文本资源，而不丢弃排序元数据。

- [ ] **第 4 步：重新运行重点测试**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k structure -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/models/source_assets.py agent-service/app/workers/mineru_parser.py agent-service/app/workers/asset_parser.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: preserve mineru structure metadata"
```

## 分块 3：解析器路由与回退

### 任务 6：引入 parser selection in `parse_assets_tool()`

**文件：**
- 修改：`agent-service/app/orchestrator/tools/parse_assets.py`
- 修改：`agent-service/app/workers/asset_parser.py`
- 测试： `agent-service/tests/orchestrator/test_parse_assets_mineru.py`

- [ ] **第 1 步：编写失败的路由测试**

```python
@pytest.mark.asyncio
async def test_parse_assets_uses_mineru_first_for_pdf(monkeypatch):
    ...
    result = await parse_assets_tool(files=[pdf_file], page_id="page-1")
    assert any(item.type == "image" for item in result.items)


@pytest.mark.asyncio
async def test_parse_assets_falls_back_to_docling_when_mineru_fails(monkeypatch):
    ...
    result = await parse_assets_tool(files=[pdf_file], page_id="page-1")
    assert result.source_word_count > 0
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
预期：失败，因为解析器选择尚不存在。

- [ ] **第 3 步：实施解析器策略**

```python
def choose_parser(filename: str, mimetype: str, mineru_enabled: bool) -> Literal["mineru", "docling"]:
    ...
```

Rules:
- `pdf/doc/docx/ppt/pptx/html/png/jpg/jpeg` -> MinerU 启用时
- `xlsx/csv/md/asciidoc/latex/xml/audio/video` -> 文档化
- 任何 MinerU 故障 -> Docling 后备

- [ ] **第 4 步：重新运行路由测试**

运行： `python -m pytest agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/workers/asset_parser.py agent-service/tests/orchestrator/test_parse_assets_mineru.py
git commit -m "feat: route supported documents through mineru first"
```

### 任务 7：保留 rehosting and source-image upgrade behavior

**文件：**
- 修改：`agent-service/app/tools/source_image_store.py`
- 修改：`agent-service/app/orchestrator/tools/parse_assets.py`
- 测试： `agent-service/tests/orchestrator/test_parse_assets.py`

- [ ] **第 1 步：编写失败的回归测试**

```python
@pytest.mark.asyncio
async def test_parse_assets_rehosts_mineru_source_images_when_page_id_present():
    ...
    assert image_item.content.startswith("/api/files/")
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/orchestrator/test_parse_assets.py -k rehosts_mineru -q`
预期：失败，因为 MinerU 映像项尚未升级。

- [ ] **第 3 步：仅根据需要调整镜像升级代码**

没有新的抽象。保持 `upgrade_source_image_assets()` 与解析器无关。

- [ ] **第 4 步：重新运行重点测试**

运行： `python -m pytest agent-service/tests/orchestrator/test_parse_assets.py -k rehosts_mineru -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/tools/source_image_store.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/tests/orchestrator/test_parse_assets.py
git commit -m "fix: 重新托管 mineru source images into docmost"
```

## 分块 4：高价值图片精筛

### 任务 8：Filter low-value image blocks before `AssetMap` emission

**文件：**
- 修改：`agent-service/app/workers/mineru_parser.py`
- 修改：`agent-service/app/workers/asset_parser.py`
- 测试： `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **第 1 步：编写失败的过滤测试**

```python
def test_filter_useful_images_removes_tiny_logo_and_keeps_main_screenshot():
    images = [...]
    filtered = filter_useful_images(images, page_width=1000, page_height=1400)
    assert len(filtered) == 1
    assert filtered[0].desc == "主业务截图"
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k useful_images -q`
预期：失败，因为过滤尚不存在。

- [ ] **第 3 步：实施最小确定性过滤**

Rules:
- 删除页面面积比低于 2% 的图像
- 删除宽度或高度低于 80 像素等效值的图像
- 更喜欢附近有非空文本/标题的图像
- 通过 `content_hash` 或感知哈希（如果可用）进行重复数据删除

- [ ] **第 4 步：重新运行重点测试**

运行： `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k useful_images -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/mineru_parser.py agent-service/app/workers/asset_parser.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: filter low-value mineru image blocks"
```

## 分块 5：保结构写作集成

### 任务 9：Ensure structure-preserving transforms bypass `simple_edit`

**文件：**
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/tests/orchestrator/test_engine.py`
- 修改：`agent-service/tests/orchestrator/test_e2e_level2.py`

- [ ] **第 1 步：编写失败的回归测试**

```python
async def test_execute_level2_promotes_when_mineru_returns_source_structure():
    ...
    assert mock_structured.await_count == 1
    assert mock_simple_edit.await_count == 0
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
预期：如果结构保留变换仍然落入 `simple_edit`，则失败。

- [ ] **第 3 步：保持升级逻辑与解析器无关**

Use:
- `AssetMap.items_by_type("image")`
- `AssetMap.source_structure`
- `brief.structure_strategy == "copy_source"`

不要在协调器决策路径中对 `parser == "mineru"` 检查进行硬编码。

- [ ] **第 4 步：重新运行测试**

运行： `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/engine.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py
git commit -m "feat: prefer structured write for mineru-backed transforms"
```

### 任务 10：Ensure MinerU-produced source images still trigger structured write promotion

**文件：**
- 修改：`agent-service/tests/orchestrator/test_engine.py`
- 修改：`agent-service/tests/orchestrator/test_e2e_level2.py`

- [ ] **第 1 步：编写失败的回归更新**

```python
async def test_execute_level2_upgrades_to_structured_write_for_mineru_images():
    ...
    assert mock_structured.await_count == 1
```

- [ ] **第 2 步：运行测试以验证 RED**

运行： `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
预期：如果 MinerU 图像项不被视为标准源图像，则失败。

- [ ] **第 3 步：保持现有促销逻辑通用**

`engine.py` 中没有特定于解析器的分支；仅断言 `AssetMap.items_by_type("image")` 仍会推动升级。

- [ ] **第 4 步：重新运行测试**

运行： `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
预期：通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py
git commit -m "test: verify mineru images trigger structured write upgrade"
```

## 分块 6：编排器与 UX 验证

### 任务 11：添加 observable parser provenance and browser-level validation

**文件：**
- 修改：`agent-service/app/orchestrator/tools/parse_assets.py`
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`

- [ ] **第 1 步：编写失败的断言**

```python
def test_browser_source_reuse_shows_parser_provenance(...):
    assert "MINERU" in candidate_state["text"]
```

- [ ] **第 2 步：运行小范围测试来验证 RED**

运行： `python -m pytest agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
预期：失败，直到发出解析器出处。

- [ ] **第 3 步：发出结构化日志/元数据**

Add:
- `parser=mineru|docling`
- `source_images_detected`
- `source_images_retained`
- `mineru_batch_id`

- [ ] **第 4 步：重新运行后端 + 浏览器检查**

运行：
- `python -m pytest agent-service/tests/tools/test_mineru_client.py agent-service/tests/workers/test_mineru_parser.py agent-service/tests/orchestrator/test_parse_assets_mineru.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`

预计：
- pytest通过
- 浏览器E2E显示源图像候选和成功重用

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/orchestrator/engine.py agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py
git commit -m "feat: expose mineru parser provenance and validation"
```

## 分块 7：交付验证

### 任务 12：运行 the full targeted regression slice

**文件：**
- 没有代码更改

- [ ] **第 1 步：运行解析器/客户端套件**

运行： `python -m pytest agent-service/tests/tools/test_mineru_client.py agent-service/tests/workers/test_mineru_parser.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
预期：通过。

- [ ] **第 2 步：运行 Orchestrator/source-image 套件**

运行： `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py -q`
预期：通过。

- [ ] **第 3 步：运行浏览器源图像接受**

运行： `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
预期：通过包含源图像链接的持久化 Markdown。

- [ ] **第 4 步：更新文档和示例**

修改：
- `.env.example`
- 任何相关的 AI Creator 解析器文档/规范说明

- [ ] **第 5 步：提交**

```bash
git add .env.example docs/superpowers/plans/2026-03-19-ai-creator-mineru-first-parsing.md
git commit -m "docs: finalize mineru-first parsing rollout"
```

## 实施者须知

- 不要将 `MINERU_API_TOKEN` 泄漏到日志、跟踪、测试或浏览器响应中。
- 不要强迫 MinerU 进入 `xlsx/csv/md/xml` 路径；保持后备明确。
- 首先优先选择确定性过滤规则；仅当确定性过滤证明不足时才添加基于 VLM 的图像有用性评分。
- 如果 MinerU API 延迟成为问题，请在更改任何解析器合约之前通过文件内容哈希添加缓存。

## 成功标准

- 上传受支持的带有屏幕截图的 PDF 会产生来自 MinerU 的 `AssetMap` 图像项目。
- 图像项目重新托管到 Docmost URL，并仍然符合蓝图/源图像重用的条件。
- 带有保留图像的单文件 `document_transform` 请求从 `simple_edit` 升级。
- 不受支持或失败的 MinerU 解析会干净地回退到 Docling，而不会破坏现有流程。

Plan complete and saved to `docs/superpowers/plans/2026-03-19-ai-creator-mineru-first-parsing.md`. Ready to execute?
