# MinerU-First Parsing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route supported uploaded documents through MinerU first so PDF/Office source images, layout blocks, and richer document structure become first-class `AssetMap` inputs for AI Creator, while preserving Docling as the fallback parser.

**Architecture:** Add a MinerU API client and a result-to-`DocumentParseResult` adapter, then introduce parser selection in `parse_assets_tool()` with `MinerU-first / Docling-fallback` routing. Preserve MinerU structure as first-class input by mapping heading/block/layout metadata into the existing `AssetMap` / `source_structure` contract, so brief/blueprint/writer can reuse source structure instead of flattening everything into plain text. Keep Docling only as a fallback for unsupported formats or MinerU failures.

**Tech Stack:** Python 3.11, FastAPI agent-service, httpx, zipfile/json parsing, Pydantic models, pytest, existing Docmost upload/rehost pipeline.

---

## File Map

### New files
- `agent-service/app/tools/mineru_client.py`
- `agent-service/app/workers/mineru_parser.py`
- `agent-service/tests/tools/test_mineru_client.py`
- `agent-service/tests/workers/test_mineru_parser.py`
- `agent-service/tests/orchestrator/test_parse_assets_mineru.py`

### Modified files
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

### Existing boundaries to preserve
- `AssetMap` remains the only parser output consumed by orchestrator, planner, evaluator, and writer.
- `upgrade_source_image_assets()` remains responsible for rehosting source images into stable Docmost URLs.
- `visual_planner.py` and `section_writer.py` must not become parser-specific.

## Current Functionality and Gaps

### Current functionality
- `parse_assets_tool()` currently parses every uploaded file through the same sync `parse_document()` worker and merges the resulting `AssetMap`.
- `asset_parser.parse_document()` currently assumes a Docling-shaped `DocumentParseResult` and flattens the source into:
  - `heading_structure`
  - `text`
  - `table`
  - `code`
  - `mermaid`
  - `image`
- `create_brief.py` already consumes `source_word_count`, asset counts, and heading summaries.
- `create_blueprint.py` already supports `copy_source` structure hints and source image candidates.
- `visual_planner.py` already ranks source images using metadata overlap.
- `section_writer.py` already knows how to preserve source material, insert source image URLs, and emit asset markers.

### Current shortcomings
- The parser layer is Docling-specific and loses layout-rich metadata before planning starts.
- Structure preservation depends on markdown heading recovery, which is weaker than a true parser block tree.
- The PDF path can produce `<!-- image -->` placeholders without actual image assets, which blocks source-image reuse and keeps single-file transforms on the `simple_edit` path.
- `simple_edit` is still too text-centric for structure-preserving transforms; the system should prefer structured write whenever a trustworthy parser returns usable source structure and images.

### Required MinerU integration stance
- Prefer MinerU whenever the input format is MinerU-supported.
- Reuse MinerU heading/block/layout information directly in planning and writing.
- Use Docling only when MinerU is unsupported, unavailable, or returns unusable output.

## Chunk 1: MinerU API Client

### Task 1: Add environment-driven MinerU client configuration

**Files:**
- Create: `agent-service/app/tools/mineru_client.py`
- Modify: `.env.example`
- Modify: `.worktrees/ai-creator-workbench/.env`
- Test: `agent-service/tests/tools/test_mineru_client.py`

- [ ] **Step 1: Write the failing test for config loading**

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

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/tools/test_mineru_client.py -k config -q`
Expected: FAIL because `MinerUConfig` does not exist yet.

- [ ] **Step 3: Implement minimal config model**

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

- [ ] **Step 4: Re-run the test**

Run: `python -m pytest agent-service/tests/tools/test_mineru_client.py -k config -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/tools/mineru_client.py agent-service/tests/tools/test_mineru_client.py .env.example .worktrees/ai-creator-workbench/.env
git commit -m "feat: add mineru client configuration"
```

### Task 2: Implement upload + polling workflow

**Files:**
- Modify: `agent-service/app/tools/mineru_client.py`
- Test: `agent-service/tests/tools/test_mineru_client.py`

- [ ] **Step 1: Write the failing test for the batch upload flow**

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

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/tools/test_mineru_client.py -k upload -q`
Expected: FAIL because `MinerUClient.extract_file()` is not implemented.

- [ ] **Step 3: Implement the client methods**

```python
class MinerUClient:
    async def request_upload_urls(...): ...
    async def upload_to_presigned_url(...): ...
    async def poll_batch_result(...): ...
    async def download_zip(...): ...
    async def extract_file(...): ...
```

- [ ] **Step 4: Re-run the focused tests**

Run: `python -m pytest agent-service/tests/tools/test_mineru_client.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/tools/mineru_client.py agent-service/tests/tools/test_mineru_client.py
git commit -m "feat: add mineru upload and polling client"
```

## Chunk 2: MinerU Result Adapter

### Task 3: Extend parse result metadata for layout-aware source images

**Files:**
- Modify: `agent-service/app/models/source_assets.py`
- Test: `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **Step 1: Write the failing test for image payload metadata**

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

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k payload -q`
Expected: FAIL because the fields do not exist yet.

- [ ] **Step 3: Add the fields to `SourceImagePayload`**

```python
bbox: list[float] = Field(default_factory=list)
nearby_text: str = ""
confidence: float = 0.0
parser: str = "docling"
is_fallback: bool = False
```

- [ ] **Step 4: Re-run the focused test**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k payload -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/models/source_assets.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: extend source image payload metadata"
```

### Task 4: Parse MinerU ZIP output into `DocumentParseResult`

**Files:**
- Create: `agent-service/app/workers/mineru_parser.py`
- Test: `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **Step 1: Write the failing test for `full.md + content_list.json` parsing**

```python
def test_parse_mineru_zip_extracts_text_and_images(sample_mineru_zip_bytes):
    result = parse_mineru_zip(sample_mineru_zip_bytes, filename="demo.pdf")

    assert "采购退货单 SOP" in result.text
    assert len(result.images) == 2
    assert result.images[0].page_number == 1
    assert "流程截图" in result.images[0].desc
```

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k parse_mineru_zip -q`
Expected: FAIL because the parser does not exist yet.

- [ ] **Step 3: Implement `parse_mineru_zip()`**

```python
def parse_mineru_zip(zip_bytes: bytes, filename: str) -> DocumentParseResult:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        ...
        return DocumentParseResult(text=text, images=images)
```

- [ ] **Step 4: Re-run the test**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/mineru_parser.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: parse mineru zip results into document assets"
```

### Task 5: Preserve MinerU structure instead of flattening it away

**Files:**
- Modify: `agent-service/app/models/source_assets.py`
- Modify: `agent-service/app/workers/mineru_parser.py`
- Modify: `agent-service/app/workers/asset_parser.py`
- Test: `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **Step 1: Write the failing test for structure-preserving conversion**

```python
def test_parse_mineru_zip_preserves_heading_tree_and_block_order(sample_mineru_zip_bytes):
    result = parse_mineru_zip(sample_mineru_zip_bytes, filename="demo.pdf")

    assert result.structure[0]["text"] == "采购退货单 SOP"
    assert result.blocks[0]["type"] == "heading"
    assert result.blocks[1]["type"] == "text"
```

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k structure -q`
Expected: FAIL because `DocumentParseResult` does not preserve structure yet.

- [ ] **Step 3: Add minimal structure fields**

```python
class DocumentParseResult(BaseModel):
    text: str = ""
    images: list[SourceImagePayload] = Field(default_factory=list)
    structure: list[dict] = Field(default_factory=list)
    blocks: list[dict] = Field(default_factory=list)
```

Populate these from MinerU output and convert them into `AssetMap.source_structure` and ordered text assets without discarding ordering metadata.

- [ ] **Step 4: Re-run the focused test**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k structure -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/models/source_assets.py agent-service/app/workers/mineru_parser.py agent-service/app/workers/asset_parser.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: preserve mineru structure metadata"
```

## Chunk 3: Parser Routing and Fallback

### Task 6: Introduce parser selection in `parse_assets_tool()`

**Files:**
- Modify: `agent-service/app/orchestrator/tools/parse_assets.py`
- Modify: `agent-service/app/workers/asset_parser.py`
- Test: `agent-service/tests/orchestrator/test_parse_assets_mineru.py`

- [ ] **Step 1: Write the failing routing tests**

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

- [ ] **Step 2: Run the tests to verify RED**

Run: `python -m pytest agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
Expected: FAIL because parser selection does not exist yet.

- [ ] **Step 3: Implement parser strategy**

```python
def choose_parser(filename: str, mimetype: str, mineru_enabled: bool) -> Literal["mineru", "docling"]:
    ...
```

Rules:
- `pdf/doc/docx/ppt/pptx/html/png/jpg/jpeg` -> MinerU when enabled
- `xlsx/csv/md/asciidoc/latex/xml/audio/video` -> Docling
- any MinerU failure -> Docling fallback

- [ ] **Step 4: Re-run the routing tests**

Run: `python -m pytest agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/workers/asset_parser.py agent-service/tests/orchestrator/test_parse_assets_mineru.py
git commit -m "feat: route supported documents through mineru first"
```

### Task 7: Preserve rehosting and source-image upgrade behavior

**Files:**
- Modify: `agent-service/app/tools/source_image_store.py`
- Modify: `agent-service/app/orchestrator/tools/parse_assets.py`
- Test: `agent-service/tests/orchestrator/test_parse_assets.py`

- [ ] **Step 1: Write the failing regression test**

```python
@pytest.mark.asyncio
async def test_parse_assets_rehosts_mineru_source_images_when_page_id_present():
    ...
    assert image_item.content.startswith("/api/files/")
```

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/orchestrator/test_parse_assets.py -k rehosts_mineru -q`
Expected: FAIL because the MinerU image items are not yet upgraded.

- [ ] **Step 3: Adjust image upgrade code only as needed**

No new abstraction. Keep `upgrade_source_image_assets()` parser-agnostic.

- [ ] **Step 4: Re-run the focused test**

Run: `python -m pytest agent-service/tests/orchestrator/test_parse_assets.py -k rehosts_mineru -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/tools/source_image_store.py agent-service/app/orchestrator/tools/parse_assets.py agent-service/tests/orchestrator/test_parse_assets.py
git commit -m "fix: rehost mineru source images into docmost"
```

## Chunk 4: Precision Filtering for Useful Images

### Task 8: Filter low-value image blocks before `AssetMap` emission

**Files:**
- Modify: `agent-service/app/workers/mineru_parser.py`
- Modify: `agent-service/app/workers/asset_parser.py`
- Test: `agent-service/tests/workers/test_mineru_parser.py`

- [ ] **Step 1: Write the failing filtering tests**

```python
def test_filter_useful_images_removes_tiny_logo_and_keeps_main_screenshot():
    images = [...]
    filtered = filter_useful_images(images, page_width=1000, page_height=1400)
    assert len(filtered) == 1
    assert filtered[0].desc == "主业务截图"
```

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k useful_images -q`
Expected: FAIL because filtering does not exist yet.

- [ ] **Step 3: Implement minimal deterministic filtering**

Rules:
- drop images whose page-area ratio is under 2%
- drop images whose width or height is under 80 px equivalent
- prefer images with non-empty nearby text / captions
- dedupe by `content_hash` or perceptual-hash when available

- [ ] **Step 4: Re-run the focused test**

Run: `python -m pytest agent-service/tests/workers/test_mineru_parser.py -k useful_images -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/mineru_parser.py agent-service/app/workers/asset_parser.py agent-service/tests/workers/test_mineru_parser.py
git commit -m "feat: filter low-value mineru image blocks"
```

## Chunk 5: Structure-Preserving Authoring Integration

### Task 9: Ensure structure-preserving transforms bypass `simple_edit`

**Files:**
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/tests/orchestrator/test_engine.py`
- Modify: `agent-service/tests/orchestrator/test_e2e_level2.py`

- [ ] **Step 1: Write the failing regression tests**

```python
async def test_execute_level2_promotes_when_mineru_returns_source_structure():
    ...
    assert mock_structured.await_count == 1
    assert mock_simple_edit.await_count == 0
```

- [ ] **Step 2: Run the test to verify RED**

Run: `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
Expected: FAIL if structure-preserving transforms still fall into `simple_edit`.

- [ ] **Step 3: Keep promotion logic parser-agnostic**

Use:
- `AssetMap.items_by_type("image")`
- `AssetMap.source_structure`
- `brief.structure_strategy == "copy_source"`

Do not hardcode `parser == "mineru"` checks in the orchestrator decision path.

- [ ] **Step 4: Re-run the tests**

Run: `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/engine.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py
git commit -m "feat: prefer structured write for mineru-backed transforms"
```

### Task 10: Ensure MinerU-produced source images still trigger structured write promotion

**Files:**
- Modify: `agent-service/tests/orchestrator/test_engine.py`
- Modify: `agent-service/tests/orchestrator/test_e2e_level2.py`

- [ ] **Step 1: Write the failing regression updates**

```python
async def test_execute_level2_upgrades_to_structured_write_for_mineru_images():
    ...
    assert mock_structured.await_count == 1
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
Expected: FAIL if MinerU image items are not treated as standard source images.

- [ ] **Step 3: Keep the existing promotion logic generic**

No parser-specific branching in `engine.py`; only assert that `AssetMap.items_by_type("image")` still drives the upgrade.

- [ ] **Step 4: Re-run the tests**

Run: `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py
git commit -m "test: verify mineru images trigger structured write upgrade"
```

## Chunk 6: Orchestrator and UX Verification

### Task 11: Add observable parser provenance and browser-level validation

**Files:**
- Modify: `agent-service/app/orchestrator/tools/parse_assets.py`
- Modify: `agent-service/app/orchestrator/engine.py`
- Modify: `agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`

- [ ] **Step 1: Write the failing assertions**

```python
def test_browser_source_reuse_shows_parser_provenance(...):
    assert "MINERU" in candidate_state["text"]
```

- [ ] **Step 2: Run the narrow tests to verify RED**

Run: `python -m pytest agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
Expected: FAIL until parser provenance is emitted.

- [ ] **Step 3: Emit structured logs / metadata**

Add:
- `parser=mineru|docling`
- `source_images_detected`
- `source_images_retained`
- `mineru_batch_id`

- [ ] **Step 4: Re-run backend + browser checks**

Run:
- `python -m pytest agent-service/tests/tools/test_mineru_client.py agent-service/tests/workers/test_mineru_parser.py agent-service/tests/orchestrator/test_parse_assets_mineru.py agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py -q`
- `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`

Expected:
- pytest passes
- browser E2E shows source image candidates and successful reuse

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py agent-service/app/orchestrator/engine.py agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py
git commit -m "feat: expose mineru parser provenance and validation"
```

## Chunk 7: Delivery Validation

### Task 12: Run the full targeted regression slice

**Files:**
- No code changes

- [ ] **Step 1: Run the parser/client suite**

Run: `python -m pytest agent-service/tests/tools/test_mineru_client.py agent-service/tests/workers/test_mineru_parser.py agent-service/tests/workers/test_asset_parser.py agent-service/tests/orchestrator/test_parse_assets.py agent-service/tests/orchestrator/test_parse_assets_mineru.py -q`
Expected: PASS.

- [ ] **Step 2: Run the orchestrator/source-image suite**

Run: `python -m pytest agent-service/tests/orchestrator/test_engine.py agent-service/tests/orchestrator/test_e2e_level2.py agent-service/tests/orchestrator/test_e2e_level3.py agent-service/tests/workers/test_evaluator.py -q`
Expected: PASS.

- [ ] **Step 3: Run the browser source-image acceptance**

Run: `python agent-service/tests/browser_ai_creator_source_image_reuse_e2e.py`
Expected: PASS with persisted markdown containing source image links.

- [ ] **Step 4: Update docs and examples**

Modify:
- `.env.example`
- any relevant AI Creator parser docs/spec notes

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/superpowers/plans/2026-03-19-ai-creator-mineru-first-parsing.md
git commit -m "docs: finalize mineru-first parsing rollout"
```

## Notes for the Implementer

- Do not leak `MINERU_API_TOKEN` to logs, traces, tests, or browser responses.
- Do not force MinerU into `xlsx/csv/md/xml` paths; keep fallback explicit.
- Prefer deterministic filtering rules first; only add VLM-based image usefulness scoring if deterministic filtering proves insufficient.
- If MinerU API latency becomes an issue, add caching by file-content hash before changing any parser contracts.

## Success Criteria

- Uploading a supported PDF with screenshots yields `AssetMap` image items from MinerU.
- The image items are rehosted to Docmost URLs and remain eligible for blueprint/source-image reuse.
- Single-file `document_transform` requests with preserved images upgrade out of `simple_edit`.
- Unsupported or failed MinerU parses fall back cleanly to Docling without breaking existing flows.

Plan complete and saved to `docs/superpowers/plans/2026-03-19-ai-creator-mineru-first-parsing.md`. Ready to execute?
