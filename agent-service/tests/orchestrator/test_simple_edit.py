"""Tests for simple_edit tool (prompt builder and request model).

Note: execute_simple_edit() requires a live LLM and is not unit-tested here.
"""
from __future__ import annotations

import pytest

from app.orchestrator.tools.simple_edit import SimpleEditRequest, build_simple_edit_prompt


# ---------------------------------------------------------------------------
# SimpleEditRequest model tests
# ---------------------------------------------------------------------------

class TestSimpleEditRequest:
    def test_minimal_request(self):
        req = SimpleEditRequest(
            thread_id="t1",
            user_message="translate to French",
        )
        assert req.thread_id == "t1"
        assert req.user_message == "translate to French"
        assert req.page_content == ""
        assert req.selected_text == ""
        assert req.system_prompt == ""
        assert req.template_prompt == ""
        assert req.conversation_history == []

    def test_full_request(self):
        req = SimpleEditRequest(
            thread_id="t2",
            user_message="fix grammar",
            page_content="This are a test.",
            selected_text="This are",
            system_prompt="You are a professional editor.",
            template_prompt="Focus on grammar only.",
            conversation_history=[{"role": "user", "content": "Hello"}],
        )
        assert req.selected_text == "This are"
        assert len(req.conversation_history) == 1

    def test_thread_id_required(self):
        with pytest.raises(Exception):
            SimpleEditRequest(user_message="fix this")  # type: ignore[call-arg]

    def test_user_message_required(self):
        with pytest.raises(Exception):
            SimpleEditRequest(thread_id="t3")  # type: ignore[call-arg]

    def test_request_is_pydantic_model(self):
        from pydantic import BaseModel
        req = SimpleEditRequest(thread_id="t4", user_message="simplify")
        assert isinstance(req, BaseModel)


# ---------------------------------------------------------------------------
# build_simple_edit_prompt tests
# ---------------------------------------------------------------------------

class TestBuildSimpleEditPrompt:
    def test_includes_user_message(self):
        req = SimpleEditRequest(thread_id="t", user_message="translate to Spanish")
        prompt = build_simple_edit_prompt(req)
        assert "translate to Spanish" in prompt

    def test_includes_selected_text_section(self):
        req = SimpleEditRequest(
            thread_id="t",
            user_message="fix grammar",
            selected_text="This are a test.",
        )
        prompt = build_simple_edit_prompt(req)
        assert "Selected Text" in prompt
        assert "This are a test." in prompt

    def test_selected_text_preferred_over_page_content(self):
        req = SimpleEditRequest(
            thread_id="t",
            user_message="fix it",
            page_content="Full document text.",
            selected_text="Just this part.",
        )
        prompt = build_simple_edit_prompt(req)
        assert "Just this part." in prompt
        # Full page content should NOT appear when selected_text is set
        assert "Full document text." not in prompt

    def test_page_content_used_when_no_selected_text(self):
        req = SimpleEditRequest(
            thread_id="t",
            user_message="simplify",
            page_content="This is a complex document.",
        )
        prompt = build_simple_edit_prompt(req)
        assert "Document Content" in prompt
        assert "This is a complex document." in prompt

    def test_system_prompt_included(self):
        req = SimpleEditRequest(
            thread_id="t",
            user_message="fix it",
            system_prompt="You are a professional proofreader.",
        )
        prompt = build_simple_edit_prompt(req)
        assert "System Instructions" in prompt
        assert "You are a professional proofreader." in prompt

    def test_template_prompt_included(self):
        req = SimpleEditRequest(
            thread_id="t",
            user_message="fix it",
            template_prompt="Focus on formal language.",
        )
        prompt = build_simple_edit_prompt(req)
        assert "Template Instructions" in prompt
        assert "Focus on formal language." in prompt

    def test_no_system_prompt_section_when_empty(self):
        req = SimpleEditRequest(thread_id="t", user_message="fix it")
        prompt = build_simple_edit_prompt(req)
        assert "System Instructions" not in prompt

    def test_no_template_section_when_empty(self):
        req = SimpleEditRequest(thread_id="t", user_message="fix it")
        prompt = build_simple_edit_prompt(req)
        assert "Template Instructions" not in prompt

    def test_includes_final_instruction(self):
        req = SimpleEditRequest(thread_id="t", user_message="fix it")
        prompt = build_simple_edit_prompt(req)
        # The prompt should end with a directive to return content only
        assert "without explanations" in prompt.lower() or "only the edited content" in prompt.lower()

    def test_prompt_is_string(self):
        req = SimpleEditRequest(thread_id="t", user_message="proofread")
        prompt = build_simple_edit_prompt(req)
        assert isinstance(prompt, str)
        assert len(prompt) > 0

    def test_all_sections_present_in_order(self):
        req = SimpleEditRequest(
            thread_id="t",
            user_message="translate to French",
            page_content="Hello world",
            system_prompt="Be concise.",
            template_prompt="Use formal tone.",
        )
        prompt = build_simple_edit_prompt(req)
        sys_pos = prompt.index("System Instructions")
        tpl_pos = prompt.index("Template Instructions")
        doc_pos = prompt.index("Document Content")
        usr_pos = prompt.index("User Request")
        assert sys_pos < tpl_pos < doc_pos < usr_pos

    def test_empty_page_content_no_section(self):
        req = SimpleEditRequest(
            thread_id="t",
            user_message="fix it",
            page_content="",
        )
        prompt = build_simple_edit_prompt(req)
        assert "Document Content" not in prompt
