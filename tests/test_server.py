import json

from fastapi.testclient import TestClient

import server


client = TestClient(server.app)


def test_root_ok():
    resp = client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"


def test_health_includes_versions():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"
    assert "yt_dlp" in data
    assert "ffmpeg" in data
    assert "max_concurrent_downloads" in data

