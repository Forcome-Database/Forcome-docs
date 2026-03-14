def test_v2_endpoints_registered():
    from app.main import app
    routes = [route.path for route in app.routes]
    assert "/v2/agent/run" in routes
    assert "/v2/agent/resume" in routes
    assert "/v2/agent/stop" in routes
