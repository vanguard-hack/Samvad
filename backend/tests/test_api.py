from fastapi.testclient import TestClient

from app.languages import STT_REST, TTS, stt_rest_code, stt_stream_code
from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_speech_endpoints_need_sign_in():
    assert client.post("/api/tts", json={"text": "hi", "language": "en"}).status_code == 401
    assert client.post("/api/translate", json={"text": "hi", "source": "en", "target": "hi"}).status_code == 401
    assert client.post("/api/stt", files={"audio": ("a.webm", b"x", "audio/webm")}).status_code == 401


def test_stream_rejects_missing_token():
    with client.websocket_connect("/api/stt/stream") as ws:
        ws.send_json({"type": "start", "token": "", "language": "auto"})
        assert ws.receive_json()["type"] == "error"


def test_language_maps():
    assert len(STT_REST) == 23  # 22 scheduled languages + English
    assert len(TTS) == 11  # same as `voice: true` in the frontend
    assert stt_rest_code("or") == "od-IN" and stt_stream_code("or") == "or-IN"
    assert stt_rest_code("auto") == "unknown" and stt_stream_code(None) == "auto"


def test_intake_needs_sign_in():
    assert client.post("/api/intake/prompt", json={"key": "name", "language": "hi"}).status_code == 401
    assert client.post("/api/intake/parse", json={"field": "age", "language": "hi", "text": "45"}).status_code == 401


def test_assistant_needs_sign_in():
    assert client.post("/api/assistant", json={"text": "hello"}).status_code == 401
