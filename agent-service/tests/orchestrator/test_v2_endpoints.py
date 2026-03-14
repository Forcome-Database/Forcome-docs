def test_v2_endpoints_registered():
    from app.main import app
    routes = [route.path for route in app.routes]
    assert "/v2/agent/run" in routes
    assert "/v2/agent/resume" in routes
    assert "/v2/agent/stop" in routes


def test_draft_endpoints_registered():
    from app.main import app
    routes = [route.path for route in app.routes]
    assert "/v2/draft/get" in routes
    assert "/v2/draft/merge" in routes
    assert "/v2/draft/delete" in routes
