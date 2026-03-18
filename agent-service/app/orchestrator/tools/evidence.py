from __future__ import annotations

import re
from typing import TYPE_CHECKING

from app.models.asset_map import AssetItem, AssetMap
from app.models.evidence import EvidenceItem, summarize_evidence
from app.orchestrator.tools.research import research_tool

if TYPE_CHECKING:
    from app.orchestrator.engine import OrchestratorRequest


URL_PATTERN = re.compile(r"https?://[^\s)>\]]+")


def extract_reference_url(text: str) -> str | None:
    match = URL_PATTERN.search(text)
    return match.group(0) if match else None


def derive_evidence_items(request: "OrchestratorRequest") -> list[EvidenceItem]:
    items: list[EvidenceItem] = []

    for file in request.files:
        filename = str(file.get("filename") or file.get("name") or "uploaded-file")
        mimetype = str(file.get("mimetype") or file.get("type") or "")
        kind = "uploaded_image" if mimetype.startswith("image/") else "uploaded_document"
        items.append(
            EvidenceItem(
                kind=kind,
                source=filename,
                required=True,
                purpose="Use the uploaded source material as grounding evidence",
            )
        )

    if request.intent_route in {"selection_edit", "document_transform"}:
        has_page_context = bool(
            (request.page_content or "").strip()
            or (request.selected_text or "").strip()
            or request.page_id
        )
        items.append(
            EvidenceItem(
                kind="page_context",
                source=request.page_id or "current_page",
                required=True,
                status="success" if has_page_context else "failed",
                purpose="Use the current page or selection as source context",
                error=None if has_page_context else "Current page context is missing",
            )
        )

    reference_url = extract_reference_url(request.user_message)
    if reference_url:
        items.append(
            EvidenceItem(
                kind="reference_url",
                source=reference_url,
                required=True,
                purpose="Read the referenced source document before planning",
            )
        )

    if not request.files and reference_url is None and request.intent_route == "document_create":
        items.append(
            EvidenceItem(
                kind="web_search",
                source=request.user_message[:200],
                required=False,
                purpose="Supplement blank-page creation with optional background research",
            )
        )

    return items


def _ensure_asset_map(asset_map: AssetMap | None) -> AssetMap:
    return asset_map if asset_map is not None else AssetMap()


def _append_research_results(
    asset_map: AssetMap | None,
    results: list[dict],
    *,
    prefix: str,
) -> AssetMap | None:
    contentful_results = [
        result for result in results if isinstance(result.get("content"), str) and result["content"].strip()
    ]
    if not contentful_results:
        return asset_map

    target = _ensure_asset_map(asset_map)
    for index, result in enumerate(contentful_results):
        content = result["content"].strip()[:3000]
        target.items.append(
            AssetItem(
                id=f"{prefix}_{index}",
                type="text",
                source=str(result.get("source") or prefix),
                content=content,
                summary=str(result.get("url") or result.get("source") or prefix)[:200],
            )
        )
        target.source_word_count += len(content.split())

    return target


def apply_uploaded_asset_evidence(
    items: list[EvidenceItem],
    *,
    asset_map: AssetMap | None,
    parse_error: str | None = None,
) -> None:
    uploaded_items = [
        item for item in items if item.kind in {"uploaded_document", "uploaded_image"}
    ]
    if not uploaded_items:
        return

    parse_succeeded = asset_map is not None
    for item in uploaded_items:
        if parse_succeeded:
            item.status = "success"
            item.error = None
        else:
            item.status = "failed"
            item.error = parse_error or "Uploaded source material could not be parsed"


async def collect_evidence(
    request: "OrchestratorRequest",
    *,
    asset_map: AssetMap | None,
    parse_error: str | None = None,
) -> tuple[AssetMap | None, list[EvidenceItem]]:
    items = derive_evidence_items(request)
    apply_uploaded_asset_evidence(items, asset_map=asset_map, parse_error=parse_error)

    for item in items:
        if item.kind == "reference_url":
            try:
                before_count = len(asset_map.items) if asset_map is not None else 0
                results = await research_tool(
                    query=item.source,
                    sources=["web_crawl"],
                    thread_id=request.thread_id,
                    workspace_id=request.workspace_id,
                )
                asset_map = _append_research_results(
                    asset_map,
                    results,
                    prefix="reference_url",
                )
                after_count = len(asset_map.items) if asset_map is not None else 0
                item.status = "success" if after_count > before_count else "failed"
                item.error = None if item.status == "success" else "Referenced URL returned no readable content"
            except Exception as exc:
                item.status = "failed"
                item.error = str(exc)[:200]
            continue

        if item.kind == "web_search":
            try:
                before_count = len(asset_map.items) if asset_map is not None else 0
                results = await research_tool(
                    query=request.user_message,
                    sources=["web_search"],
                    thread_id=request.thread_id,
                    workspace_id=request.workspace_id,
                )
                asset_map = _append_research_results(
                    asset_map,
                    results,
                    prefix="web_search",
                )
                after_count = len(asset_map.items) if asset_map is not None else 0
                item.status = "success" if after_count > before_count else "failed"
                item.error = None if item.status == "success" else "Web search returned no usable evidence"
            except Exception as exc:
                item.status = "failed"
                item.error = str(exc)[:200]

    return asset_map, items


def failed_required_evidence(items: list[EvidenceItem]) -> list[EvidenceItem]:
    return [
        item for item in items if item.required and item.status != "success"
    ]


def build_evidence_snapshot(items: list[EvidenceItem]) -> dict:
    return {
        "evidence_summary": summarize_evidence(items),
        "failed_evidence_items": failed_required_evidence(items),
    }
