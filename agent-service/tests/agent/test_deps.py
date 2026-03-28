"""测试 AgentDeps 的创建和会话隔离保证。"""
from app.agent.deps import AgentDeps


def test_deps_creation():
    deps = AgentDeps(
        thread_id="thread-001",
        page_id="page-001",
        workspace_id="ws-001",
        user_id="user-001",
        docmost_base_url="http://localhost:3000",
        internal_secret="secret",
    )
    assert deps.thread_id == "thread-001"
    assert deps.page_id == "page-001"
    assert deps.workspace_id == "ws-001"
    assert deps.user_id == "user-001"
    assert deps.uploaded_image_urls == {}
    assert deps.files == []
    assert deps.session_store is None


def test_deps_page_id_can_be_none():
    deps = AgentDeps(
        thread_id="t1",
        page_id=None,
        workspace_id="w",
        user_id="u",
        docmost_base_url="http://x",
        internal_secret="s",
    )
    assert deps.page_id is None


def test_deps_isolation():
    """两个 AgentDeps 实例的可变字段必须完全隔离，不共享状态。"""
    d1 = AgentDeps(
        thread_id="t1", page_id=None, workspace_id="w", user_id="u",
        docmost_base_url="http://x", internal_secret="s",
    )
    d2 = AgentDeps(
        thread_id="t2", page_id=None, workspace_id="w", user_id="u",
        docmost_base_url="http://x", internal_secret="s",
    )
    # 修改 d1 不应影响 d2
    d1.uploaded_image_urls["img"] = "http://url"
    d1.files.append({"filename": "test.pdf"})
    assert "img" not in d2.uploaded_image_urls
    assert len(d2.files) == 0


def test_deps_files_populated():
    """files 字段可以在创建时传入。"""
    files = [{"content_b64": "dGVzdA==", "filename": "doc.pdf", "mimetype": "application/pdf"}]
    deps = AgentDeps(
        thread_id="t1", page_id=None, workspace_id="w", user_id="u",
        docmost_base_url="http://x", internal_secret="s",
        files=files,
    )
    assert len(deps.files) == 1
    assert deps.files[0]["filename"] == "doc.pdf"


def test_deps_page_content_default_empty():
    """page_content 默认为空字符串。"""
    deps = AgentDeps(
        thread_id="t1", page_id=None, workspace_id="w", user_id="u",
        docmost_base_url="http://x", internal_secret="s",
    )
    assert deps.page_content == ""


def test_deps_page_content_populated():
    """page_content 可以在创建时传入。"""
    deps = AgentDeps(
        thread_id="t1", page_id=None, workspace_id="w", user_id="u",
        docmost_base_url="http://x", internal_secret="s",
        page_content="# Hello World",
    )
    assert deps.page_content == "# Hello World"
