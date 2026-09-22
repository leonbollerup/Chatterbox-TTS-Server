"""Trusted-LAN dual-model inference gateway. One worker; no public exposure."""
import os
import asyncio
import threading
import time
import uuid
from collections import OrderedDict
from typing import Literal
from pydantic import BaseModel, Field
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
    data = []
    for name, url in BACKENDS.items():
        try:
            r = requests.get(url + "/api/model-info", timeout=5)
            r.raise_for_status()
            info = r.json()
        except requests.RequestException:
            raise HTTPException(503, "Backend discovery unavailable")
        data.append({"id": name, "object": "model", "languages": list(info.get("supported_languages", {})),
                     "streaming": True, "voice_modes": ["predefined", "clone"],
                     "formats": ["wav", "mp3", "opus", "pcm_s16le"], "sample_rate": 24000,
                     "streaming_formats": ["wav", "pcm_s16le"],
                     "clone_endpoint": "/tts", "gpu_cancellation_supported": False})
    return {"object": "list", "data": data}

@app.get("/v1/voices")
def voices():
    try:
        r = requests.get(BACKENDS["turbo"] + "/get_predefined_voices", timeout=5)
        r.raise_for_status()
        catalog = r.json()
        capabilities = models()["data"]
    except requests.RequestException:
        raise HTTPException(503, "Voice catalog unavailable")
    return {"voices": [{"id": v["filename"], "display_name": v.get("display_name", v["filename"]),
                        "supported_models": list(BACKENDS),
                        "languages": {m["id"]: m["languages"] for m in capabilities},
                        "recording_language": v.get("recording_language", "unknown"),
                        "sample_rate": 24000, "preview_url": None} for v in catalog]}

class SpeechRequest(BaseModel):
    model: str = "auto"
    input: str = Field(min_length=1, max_length=20000)
    voice: str
    response_format: Literal["wav", "mp3", "opus", "pcm_s16le"] = "wav"
    speed: float = Field(default=1.0, ge=0.25, le=4)
    language: str = "en"
    seed: int | None = None
    stream: bool = False
    split_text: bool = True
    chunk_size: int = Field(default=120, ge=50, le=500)

records = OrderedDict()
records_lock = threading.Lock()

def record_new(model):
    rid = str(uuid.uuid4())
    with records_lock:
        now = time.time()
        for key in list(records):
            if now - records[key]["created_at"] > 3600:
                del records[key]
        while len(records) >= 500:
            records.popitem(last=False)
        records[rid] = {"request_id":rid, "model":model, "created_at":now,
                        "status":"queued", "bytes_sent":0,
                        "gpu_cancellation_supported":False}
        return rid, records[rid]

@app.get("/v1/audio/requests/{request_id}")
def request_metrics(request_id: str):
    with records_lock:
        if request_id not in records or time.time()-records[request_id]["created_at"] > 3600:
            raise HTTPException(404, "Metrics expired or unknown request")
        return dict(records[request_id])

@app.post("/v1/audio/speech", response_class=StreamingResponse,
          responses={200:{"content":{"audio/wav":{}, "audio/pcm":{}, "audio/mpeg":{}, "audio/ogg":{}}}})
async def speech(payload: SpeechRequest, request: Request):
    if payload.response_format == "pcm_s16le" and not payload.stream:
        raise HTTPException(400, "pcm_s16le requires stream=true")
    if payload.stream and payload.response_format not in {"wav", "pcm_s16le"}:
        raise HTTPException(400, "Streaming supports wav or pcm_s16le")
    data = payload.model_dump(exclude_none=True)
    if payload.stream:
        data = dict(model=payload.model, text=payload.input, voice_mode="predefined",
                    predefined_voice_id=payload.voice, language=payload.language,
                    speed_factor=payload.speed, stream=True, output_format="wav",
                    split_text=payload.split_text, chunk_size=payload.chunk_size)
        if payload.seed is not None:
            data["seed"] = payload.seed
    return await infer(request, data, "/tts" if payload.stream else "/v1/audio/speech",
                       payload.response_format == "pcm_s16le")

@app.post("/tts", response_class=StreamingResponse)
async def custom(request: Request):
    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    return await infer(request, data, "/tts", False)

async def infer(request, payload, backend_path, raw_pcm):
    from starlette.concurrency import run_in_threadpool
    if not isinstance(payload, dict):
        raise HTTPException(400, "Expected JSON object")
    selector = payload.get("model", "auto")
    if not isinstance(selector, str):
        raise HTTPException(400, "model must be a string")
    model = ALIASES.get(selector)
    if model is None:
        raise HTTPException(400, "model must be auto, turbo or multilingual")
    language = payload.get("language") or "en"
    if model == "auto":
        model = "turbo" if language == "en" else "multilingual"
    if model == "turbo" and language != "en":
        raise HTTPException(400, "Turbo supports English only; use multilingual")
    if not isinstance(language, str):
        raise HTTPException(400, "language must be a string")
    payload["language"] = language
    if backend_path == "/tts":
        payload.pop("model", None)
    else:
        payload["model"] = "chatterbox-" + model
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "Inference queue full")
    rid, metric = record_new(model)
    started = time.monotonic()
    acquired = False
    try:
        while not acquired:
            if await request.is_disconnected():
                metric.update(status="cancelled", elapsed_seconds=time.monotonic()-started)
                raise HTTPException(499, "Client disconnected while queued")
            acquired = queue.acquire(blocking=False)
            if not acquired:
                if time.monotonic()-started > 300:
                    metric["status"] = "failed"
                    raise HTTPException(503, "Inference queue timeout")
                await asyncio.sleep(0.05)
    except BaseException:
        if acquired:
            queue.release()
        slots.release()
        raise
    def connect():
        try:
            metric.update(status="preparing", queue_wait_seconds=time.monotonic()-started)
            info = requests.get(BACKENDS[model]+"/api/model-info", timeout=10).json()
            if not info.get("loaded") or info.get("type") != model:
                raise HTTPException(503, "Backend is not loaded with requested model")
            response = requests.post(BACKENDS[model]+backend_path, json=payload,
                                     stream=True, timeout=(10, 300))
            if response.status_code != 200:
                code = response.status_code
                response.close()
                raise HTTPException(code, "Backend rejected speech request")
            metric["status"] = "streaming"
            return response
        except Exception:
            metric["status"] = "failed"
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
        header = bytearray()
        complete = False
        try:
            for chunk in response.iter_content(chunk_size=4096):
                if raw_pcm and len(header) < 44:
                    needed = 44-len(header)
                    header.extend(chunk[:needed])
                    chunk = chunk[needed:]
                    if len(header) == 44:
                        import struct
                        if (header[:4] != b"RIFF" or header[8:12] != b"WAVE" or
                            header[12:16] != b"fmt " or header[36:40] != b"data" or
                            struct.unpack_from("<HHI", header, 20) != (1, 1, 24000) or
                            struct.unpack_from("<H", header, 34)[0] != 16):
                            raise RuntimeError("Unexpected backend WAV format")
                if not chunk:
                    continue
                metric.setdefault("first_audio_seconds", time.monotonic()-started)
                metric["bytes_sent"] += len(chunk)
                yield chunk
            if raw_pcm and len(header) != 44:
                raise RuntimeError("Incomplete WAV header")
            complete = True
        except Exception:
            metric["status"] = "failed"
            raise
        finally:
            if metric["status"] != "failed":
                metric["status"] = "complete" if complete else "disconnected"
            metric["elapsed_seconds"] = time.monotonic()-started
            if raw_pcm:
                metric["audio_seconds_sent"] = metric["bytes_sent"]/48000
            close()
    return StreamingResponse(audio(), media_type="audio/pcm" if raw_pcm else response.headers.get("Content-Type", "audio/wav"),
                             headers={"X-TTS-Model":model,"X-Accel-Buffering":"no", "X-Request-ID":rid,
                                      **({"X-Audio-Sample-Rate":"24000", "X-Audio-Channels":"1",
                                          "X-Audio-Sample-Format":"s16le"} if raw_pcm else {})},
                             background=BackgroundTask(close))
