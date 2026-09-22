# Dual-model LAN deployment

Turbo remains on port 8004 (including management UI). Multilingual binds loopback port 8005 using CHATTERBOX_CONFIG=config.multilingual.yaml. Gateway port 8006 exposes /tts, /v1/audio/speech, /health and /v1/models. Model values: auto, turbo, multilingual; auto routes en to Turbo, other languages to Multilingual. /tts stream=true forwards incremental WAV; OpenAI route remains buffered upstream.

Both models stay loaded on the existing shared GPU allocation. Gateway serializes complete requests, bounded at eight outstanding; engine advisory file lock additionally serializes synthesis across local processes. This does not isolate unrelated GPU workloads. Use one gateway worker. Do not change the Turbo backend model through the legacy UI while using the gateway; health detects mismatch and inference rejects it.

No authentication: LAN/VPN only. Public deployment needs authenticated TLS ingress, inference-only route allowlist, buffering disabled and request limits. Management UI stays private.

Deployment examples in deploy/ are site-specific systemd units. Create the multilingual config from local config, setting model.repo_id=chatterbox-multilingual, host=127.0.0.1, port=8005 and separate log. Keep config and recordings private. Config path selection defaults to config.yaml for compatibility.

Rollback: stop/disable gateway and multilingual; restore pre-dual source/config backup and restart only chatterbox-web. Backups are not committed. Existing CPU environment retained.

Validation: both loaded, English Turbo and Swedish Multilingual streaming requests HTTP200; first 4096 bytes 3.10s / 4.80s in short smoke tests. Not a sustained-load, cancellation or browser acceptance test. Legacy UI still manages Turbo only, not gateway model routing.
