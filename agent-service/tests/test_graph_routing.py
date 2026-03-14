from app.agent.graph import route_after_reviewer


def test_reviewer_routes_to_writer_when_revision_needed_and_under_max():
    state = {"needs_revision": True, "iteration_count": 1, "max_iterations": None}
    assert route_after_reviewer(state) == "writer"


def test_reviewer_routes_to_done_when_at_max_iterations():
    state = {"needs_revision": True, "iteration_count": 3, "max_iterations": None}
    assert route_after_reviewer(state) == "done"


def test_reviewer_routes_to_done_when_no_revision_needed():
    state = {"needs_revision": False, "iteration_count": 0, "max_iterations": None}
    assert route_after_reviewer(state) == "done"
