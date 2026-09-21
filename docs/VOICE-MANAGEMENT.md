# Voice management fork: checkpoint and roadmap

## Scope
This fork retains the upstream Chatterbox server, API and inference engine. The first checkpoint improves the browser voice workflow; it does not implement a new model or a complete voice catalog backend.

## Implemented
- Prominent Add voice button opens a named-upload dialog for predefined voices.
- Local recording playback before upload using a browser object URL; this is not a generated speech preview.
- Name entry, WAV/MP3 selection, required permission acknowledgement, client-side 25 MiB limit and case-insensitive duplicate filename check.
- Existing upload_predefined_voice endpoint handles uploads; returned voice list is refreshed and the uploaded voice selected.
- Search saved voices by display name; a reference-language filter distinguishes the locally catalogued English references Amy/Peter/Emma from uncatalogued references.
- Existing filenames and API identifiers remain unchanged. Recordings are shared across model choices.
- Instructions distinguish reference language from output language and explain that Swedish output requires Multilingual with Swedish selected.
- Cache-busted script URL ensures refreshed pages load the matching controls.

## Use
Open Predefined Voices, click Add voice, enter a name, choose a clean single-speaker recording, listen, acknowledge permission, then Save voice. Use recordings you have rights to clone. Prefer approximately 10–20 seconds without noise/music. Select the output language separately. A name or English reference does not establish a speaker nationality or guarantee native Swedish pronunciation.

## Known limitations and security boundaries
- Language filter is hard-coded for three operator catalog entries, NOT automatic audio language detection. Other voices are uncatalogued, not presumed English.
- Upload form does not persist language, accent, source or consent metadata. The checkbox is an acknowledgement, not an audit record.
- Names currently normalize to ASCII letters/digits/underscore/hyphen; Swedish characters are not retained in filenames.
- Client-side size and duplicate checks are convenience checks, not backend security enforcement. Concurrent uploads can race; upstream skips existing names.
- No saved-reference preview, dedicated generated preview, edit, deletion/trash, automatic language/model routing, or multi-model residency has been added.
- Voice Cloning still uses the upstream file picker even though its button is also labelled Add voice.
- Browser accessibility, escape-close/audio cleanup, cross-browser support and automated UI regression testing need review.
- Retain LAN-only/restricted access until authentication and upload/path validation are explicitly reviewed. This checkpoint does not claim to harden upstream security.

## Verification actually performed
- Operator reported uploading successfully and seeing the saved voice.
- Operator reported Swedish output worked after explicitly selecting Swedish.
- Served HTML/JavaScript and voice-list API inspected successfully; service remained active.
- Git whitespace/diff check passed before checkpoint.
- No automated browser end-to-end or JavaScript runtime regression suite has run; these are gaps, not passing tests.

## Deployment observations (not portable configuration)
CUDA PyTorch 2.5.1+cu121 was validated on a shared 20 GiB RTX A4500. A same-text/voice/seed comparison produced 10.72s audio in 34.35s on CPU; three warm GPU runs produced 10.6s audio in a mean 4.11s (about 8.4x lower request latency). This is a small local benchmark, not a general throughput guarantee. GPU sample utilization was 34–46%; total shared-card memory about 5.1 GiB. No other-service concurrent inference benchmark or CUDA reboot-persistence acceptance was performed.

## Next phase: persistent catalog and predictable routing
1. Design a versioned server-side catalog keyed by stable filename/voice ID. Store display name, reference language, preferred output language, optional accent and rights/source. Unknown stays unknown. Use atomic writes and safe path resolution; preserve recordings and legacy API identifiers.
2. Implement read/edit catalog APIs and metadata-aware upload. Enforce validation on the server, prevent replacement races, test Unicode names and concurrent edits. Do not publish private voice metadata.
3. Wire upload/edit fields and selection to saved defaults. Non-English routes to Multilingual; English may retain a compatible loaded model to avoid needless switching. Validate supported languages. Show loading state and gate generation until ready; prevent model swaps racing active generation.
4. Implement recoverable delete and restore with explicit confirmation, trash metadata, no permanent deletion and safe handling of active/default voices.
5. Test migrations, API compatibility, upload/edit/restore, restarts, language routing, concurrency and browser flows on isolated fixtures before release.

Acceptance: upload a Swedish reference with Swedish output default; refresh/reopen browser; selecting it restores Swedish and uses Multilingual without manual model knowledge. Edit works without renaming API IDs. Delete hides it, restore returns it with metadata/audio intact. Legacy clients and other saved voices continue working.

## Git and recovery workflow
origin is the operator fork; upstream remains devnen/Chatterbox-TTS-Server. Develop on sky/voice-management. Push only on explicit request; upstream merges are deliberate. Code checkpoint is not a data backup. Back up recordings, catalog, private config and environment separately before backend changes. Keep CPU/runtime rollback and a tested container backup. Never commit tokens, private config, operator recordings, output audio, caches, logs or environment directories. The inherited upstream example config and bundled recordings are already versioned; do not confuse them with newly uploaded private assets.
