"""Trusted-LAN dual-model inference gateway. One worker; no public exposure."""
import os
import threading
import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

app = FastAPI(title="Chatterbox dual-model gateway")
BACKENDS = {"turbo": os.environ.get("TURBO_URL", "http://127.0.0.1:8004"),
            "multilingual": os.environ.get("MULTILINGUAL_URL", "http://127.0.0.1:8005")}
ALIASES = {"auto":"auto", "turbo":"turbo", "chatterbox-turbo":"turbo",
           "multilingual":"multilingual", "chatterbox-multilingual":"multilingual"}
# Serializes complete responses (not merely individual text chunks).
queue = threading.Lock()
slots = threading.BoundedSemaphore(8)

@app.get("/health")
def health():
    states = {}
    for name, url in BACKENDS.items():
        try:
            r = requests.get(url + "/api/model-info", timeout=3)
            r.raise_for_status()
            info = r.json()
            states[name] = {"ready": bool(info.get("loaded") and info.get("type") == name),
                            "type": info.get("type")}
        except requests.RequestException:
            states[name] = {"ready": False}
    return {"backends": states, "active_generation_limit": 1}

@app.get("/v1/models")
def models():
    return {"object":"list", "data":[{"id":n,"object":"model"} for n in BACKENDS]}

@app.post("/tts")
@app.post("/v1/audio/speech")
async def infer(request: Request):
    from starlette.concurrency import run_in_threadpool
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    if not isinstance(payload, dict):
        raise HTTPException(400, "Expected JSON object")
    model = ALIASES.get(payload.get("model", "auto"))
    if model is None:
        raise HTTPException(400, "model must be auto, turbo or multilingual")
    language = payload.get("language") or "en"
    if model == "auto":
        model = "turbo" if language == "en" else "multilingual"
    if model == "turbo" and language != "en":
        raise HTTPException(400, "Turbo supports English only; use multilingual")
    payload["language"] = language
    if request.url.path == "/tts":
        payload.pop("model", None)
    else:
        payload["model"] = "chatterbox-" + model
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "Inference queue full")
    def connect():
        acquired = False
        try:
            acquired = queue.acquire(timeout=300)
            if not acquired:
                raise HTTPException(503, "Inference queue timeout")
            info = requests.get(BACKENDS[model]+"/api/model-info", timeout=10).json()
            if not info.get("loaded") or info.get("type") != model:
                raise HTTPException(503, "Backend is not loaded with requested model")
            response = requests.post(BACKENDS[model]+request.url.path, json=payload,
                                     stream=True, timeout=(10, 300))
            if response.status_code != 200:
                code = response.status_code
                response.close()
                raise HTTPException(code, "Backend rejected speech request")
            return response
        except Exception:
            if acquired:
                queue.release()
            slots.release()
            raise
    try:
        response = await run_in_threadpool(connect)
    except requests.RequestException:
        raise HTTPException(502, "Backend unavailable")
    cleanup_lock = threading.Lock()
    closed = False
    def close():
        nonlocal closed
        with cleanup_lock:
            if not closed:
                closed = True
                response.close()
                queue.release()
                slots.release()
    def audio():
        try:
            yield from response.iter_content(chunk_size=4096)
        finally:
            close()
    return StreamingResponse(audio(), media_type=response.headers.get("Content-Type", "audio/wav"),
                             headers={"X-TTS-Model":model,"X-Accel-Buffering":"no"},
                             background=BackgroundTask(close))
