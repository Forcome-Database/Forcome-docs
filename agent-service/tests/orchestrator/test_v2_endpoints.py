def test_agent_endpoints_registered():
    from app.main import app
    routes = [route.path for route in app.routes]
    assert "/agent/run" in routes
    assert "/agent/resume" in routes
    assert "/agent/stop" in routes


def test_draft_endpoints_registered():
    from app.main import app
    routes = [route.path for route in app.routes]
    assert "/v2/draft/get" in routes
    assert "/v2/draft/merge" in routes
    assert "/v2/draft/delete" in routes
