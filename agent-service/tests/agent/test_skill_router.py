"""测试 skill_router.select_skill() 路由逻辑。"""
from app.agent.skill_router import select_skill


def test_first_turn_with_files_returns_creation():
    assert select_skill(has_message_history=False, has_files=True) == "creation"


def test_first_turn_no_files_returns_creation():
    assert select_skill(has_message_history=False, has_files=False) == "creation"


def test_follow_up_turn_returns_editing():
    assert select_skill(has_message_history=True, has_files=False) == "editing"


def test_follow_up_with_new_files_returns_creation():
    assert select_skill(has_message_history=True, has_files=True) == "creation"


def test_first_turn_with_selection_returns_editing():
    """Selection editing on the first turn should use editing skill."""
    assert select_skill(has_message_history=False, has_files=False, has_selection=True) == "editing"


def test_selection_with_files_returns_creation():
    """Selection + new files → creation (file processing takes priority)."""
    assert select_skill(has_message_history=False, has_files=True, has_selection=True) == "creation"


def test_default_has_selection_false():
    """has_selection defaults to False (backward compat)."""
    assert select_skill(has_message_history=False, has_files=False) == "creation"
