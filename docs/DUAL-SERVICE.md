# Dual-model LAN deployment

Turbo remains on port 8004 (including management UI). Multilingual binds loopback port 8005 using CHATTERBOX_CONFIG=config.multilingual.yaml. Gateway port 8006 exposes /tts, /v1/audio/speech, /health and /v1/models. Model values: auto, turbo, multilingual; auto routes en to Turbo, other languages to Multilingual. /tts stream=true forwards incremental WAV; OpenAI route remains buffered upstream.

Both models stay loaded on the existing shared GPU allocation. Gateway serializes complete requests, bounded at eight outstanding; engine advisory file lock additionally serializes synthesis across local processes. This does not isolate unrelated GPU workloads. Use one gateway worker. Do not change the Turbo backend model through the legacy UI while using the gateway; health detects mismatch and inference rejects it.

No authentication: LAN/VPN only. Public deployment needs authenticated TLS ingress, inference-only route allowlist, buffering disabled and request limits. Management UI stays private.

Deployment examples in deploy/ are site-specific systemd units. Create the multilingual config from local config, setting model.repo_id=chatterbox-multilingual, host=127.0.0.1, port=8005 and separate log. Keep config and recordings private. Config path selection defaults to config.yaml for compatibility.

Rollback: stop/disable gateway and multilingual; restore pre-dual source/config backup and restart only chatterbox-web. Backups are not committed. Existing CPU environment retained.

Validation: both loaded, English Turbo and Swedish Multilingual streaming requests HTTP200; first 4096 bytes 3.10s / 4.80s in short smoke tests. Not a sustained-load, cancellation or browser acceptance test. Legacy UI still manages Turbo only, not gateway model routing.

## Native streaming gateway update

POST /v1/audio/speech now accepts input, voice, model, language, speed, seed,
stream, split_text and chunk_size. For raw PCM use response_format=pcm_s16le
and stream=true. Streaming formats: wav or pcm_s16le. Default stream=false
preserves the legacy batch route (wav/mp3/opus). PCM uses audio/pcm and
X-Audio-Sample-Rate: 24000, X-Audio-Channels: 1,
X-Audio-Sample-Format: s16le. All successful speech responses include X-Request-ID.
The backend crossfade is already rendered; do not overlap chunks again.
Network reads are not sample or sentence boundaries.

GET /v1/audio/requests/{request_id} returns gateway-observed timing/status and
byte counts. In-memory retention: up to 500 entries, at most one hour; restart
clears records. PCM metrics include emitted audio duration. These are not
model-internal generating/decoding timings or client audible-playback timing.
GET /v1/models provides language/format capabilities. GET /v1/voices provides
voice metadata; sample_rate describes output audio, preview_url is currently null.
OpenAI-style request and audio response types are documented in /docs.

Verified: raw PCM HTTP200, 157440 bytes, 3.28 seconds audio; first 4096 bytes
at 1.324 seconds for short Amy request. Finalized batch WAV remained 24kHz.
Discovery and OpenAPI checks passed. Turbo sv/da rejected HTTP400 on both
routes. Disconnected queued request unit test passed without backend invocation.

Remaining work: cooperative backend cancellation between chunks and during
inference, full generation/decoding instrumentation, improved hard-bound text
splitter, silence measurement/trimming, preview URLs, restricted CORS, broader
streaming/disconnect and format regression tests. Queue disconnect polling is
50ms; active GPU cancellation is NOT supported. Existing backend disconnect
behavior is not an end-to-end cancellation guarantee. Do not report this release
as completion of those remaining tasks. Request IDs become available with the
response headers, not immediately upon entry to the queue.

Gateway rollback: restore /opt/chatterbox-backups/gateway-pre-pcm.py as
/opt/chatterbox-web/dual_gateway.py and restart chatterbox-gateway only.
