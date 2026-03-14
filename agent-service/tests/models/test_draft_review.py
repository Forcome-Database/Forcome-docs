from app.models.draft import SectionDraft
from app.models.review import ReviewIssue, ReviewReport


# --- SectionDraft tests ---

def test_section_draft_defaults():
    draft = SectionDraft(section_id="sec_001")
    assert draft.section_id == "sec_001"
    assert draft.content == ""
    assert draft.word_count == 0
    assert draft.budget_compliance == 1.0
    assert draft.assets_used == []
    assert draft.visuals_generated == []


def test_section_draft_full():
    draft = SectionDraft(
        section_id="sec_002",
        content="This is the draft content.",
        word_count=500,
        budget_compliance=0.95,
        assets_used=["asset_1", "asset_2"],
        visuals_generated=["img_url_1"],
    )
    assert draft.word_count == 500
    assert draft.budget_compliance == 0.95
    assert len(draft.assets_used) == 2
    assert len(draft.visuals_generated) == 1


def test_section_draft_serialization():
    draft = SectionDraft(section_id="sec_003", content="Hello world", word_count=2)
    data = draft.model_dump()
    restored = SectionDraft.model_validate(data)
    assert restored == draft


# --- ReviewIssue tests ---

def test_review_issue_creation():
    issue = ReviewIssue(
        id="issue_001",
        severity="warning",
        category="length",
        description="Section is too short",
        suggestion="Add more detail",
        auto_fixable=False,
    )
    assert issue.id == "issue_001"
    assert issue.severity == "warning"
    assert issue.category == "length"
    assert issue.section_id is None
    assert issue.fixed is False


def test_review_issue_with_section():
    issue = ReviewIssue(
        id="issue_002",
        section_id="sec_001",
        severity="error",
        category="content",
        description="Missing required content",
        auto_fixable=True,
    )
    assert issue.section_id == "sec_001"
    assert issue.auto_fixable is True


# --- ReviewReport tests ---

def test_review_report_defaults():
    report = ReviewReport()
    assert report.overall_score == 0
    assert report.length_compliance == 0.0
    assert report.asset_reuse_rate == 0.0
    assert report.issues == []
    assert report.auto_fixed_count == 0
    assert report.user_decision_needed == []


def test_review_report_pending_issues():
    report = ReviewReport(issues=[
        ReviewIssue(id="1", severity="error", category="content", description="Missing intro", auto_fixable=False, fixed=False),
        ReviewIssue(id="2", severity="warning", category="style", description="Passive voice", auto_fixable=True, fixed=False),
        ReviewIssue(id="3", severity="info", category="format", description="Check formatting", auto_fixable=False, fixed=True),
    ])
    pending = report.pending_issues()
    # pending = not fixed AND not auto_fixable
    assert len(pending) == 1
    assert pending[0].id == "1"


def test_review_report_auto_fixable_issues():
    report = ReviewReport(issues=[
        ReviewIssue(id="1", severity="error", category="content", description="Missing intro", auto_fixable=False),
        ReviewIssue(id="2", severity="warning", category="style", description="Passive voice", auto_fixable=True, fixed=False),
        ReviewIssue(id="3", severity="info", category="format", description="Already fixed", auto_fixable=True, fixed=True),
    ])
    fixable = report.auto_fixable_issues()
    # auto_fixable AND not fixed
    assert len(fixable) == 1
    assert fixable[0].id == "2"


def test_review_report_serialization():
    report = ReviewReport(
        overall_score=85,
        length_compliance=0.95,
        asset_reuse_rate=0.8,
        issues=[
            ReviewIssue(id="1", severity="info", category="style", description="Minor style note"),
        ],
        auto_fixed_count=3,
        user_decision_needed=["Decide on image reuse"],
    )
    data = report.model_dump()
    restored = ReviewReport.model_validate(data)
    assert restored.overall_score == 85
    assert len(restored.issues) == 1
    assert restored == report
