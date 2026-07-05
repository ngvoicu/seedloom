# Seedloom — agent & contributor guide

This guide is kept **byte-identical** in `AGENTS.md` and `CLAUDE.md` (a parity test in the suite enforces it). Edit one, copy to the other, run `npm test`.

## What this is

**Seedloom** is a zero-dependency Node CLI (`bin/seedloom.mjs`, binary `seedloom`) that turns BytePlus Seed-family models — **Seedance video, Seed TTS voices (incl. voice cloning), Seedream images, seed-1.8 clip QA** — into **local media files** for coding agents and HyperFrames compositions. This one repo ships both surfaces: the **engine** (installs from GitHub via `npm i -g ngvoicu/seedloom`; npm publish later) and the **universal skill** (`SKILL.md` at root, installed with `npx skills add ngvoicu/seedloom -g` — Spec Mint pattern). Host-specific packaging (Claude Code plugin, Codex plugin, MCP server) can layer on later — see `docs/distribution-2026-07.md`.

- Product shape, install, usage: `README.md`.
- The verified API research behind every design decision: `docs/research-2026-07-byteplus.md` (adversarially verified 2026-07-03).
- Packaging/distribution plan (plugins, connectors, MCP registry): `docs/distribution-2026-07.md`.

## Source layout

- `bin/seedloom.mjs` — CLI entry and command rendering. Thin; logic lives in `lib/`.
- `lib/config.js` — config home (`SEEDLOOM_HOME` || `~/.seedloom`), `DEFAULT_CONFIG` (endpoints + model IDs), deep-merge overrides from `config.json`, credentials, key masking.
- `lib/http.js` — fetch helpers (loud errors carrying response bodies; no blind retries — generation bills money) + download-to-disk.
- `lib/ark.js` — ModelArk client: Seedance task submit/poll, Seedream images, seed-1.8 clip QA; local images/clips inlined as base64 data URLs.
- `lib/voice.js` — Seed Speech HTTP unidirectional TTS: streamed JSON-chunk parsing, base64 concat, pcm→wav wrapping, resource-id routing (S_ voices → ICL).
- `lib/commands.js` — generation command handlers + flag parsing; progress on stderr, summary/JSON on stdout.
- `lib/runs.js` — `./seedloom-runs/<id>/` run dirs + `result.json` (override root via `SEEDLOOM_RUNS_DIR`).
- `SKILL.md` — the canonical universal skill (root). The only teaching artifact.
- `skills/seedloom/SKILL.md` — **symlink** to `../../SKILL.md` for tools that discover skills under `skills/<name>/`. Never replace it with a copy in this repo (Windsurf users copy it locally on install — their side).
- `tests/core.test.mjs` + `tests/generation.test.mjs` — `node --test`; spawn the CLI against a temp `SEEDLOOM_HOME` with credential env vars stripped; generation tests run local fake BytePlus servers and assert our request shapes; includes the AGENTS/CLAUDE parity test.
- `docs/` — the research and distribution reports (living references; update them when API reality drifts).

## Skill rules (engine and skill live at the same commit — keep them in lockstep)

- **When a new CLI capability lands, widen `SKILL.md` in the same commit.** The skill documents only what the CLI actually ships — no planned/stub surface; today that is `video | tts | image | qa` plus setup/diagnostics, and it explicitly forbids `voices`/`clone` until they exist.
- **The skill never bundles the CLI.** The installed skill file resolves `seedloom` from PATH, else runs it zero-install via `npx -y github:ngvoicu/seedloom`; it degrades to an install hint only when npx cannot reach the repo. No vendoring, no reimplementation — the Kluris discipline.
- **Skill `description` is the trigger** — keep it accurate about what exists; a description that promises generation before the CLI ships it sends agents into dead ends.
- Never echo credentials in skill instructions or examples; the CLI masks them.
- Verify after skill edits: `ls -la skills/seedloom/` (symlink resolves) and `head -5 SKILL.md` (frontmatter present).

## Working here

- **Zero runtime dependencies.** Plain Node ESM (>= 20), stdlib + `fetch` only. No build step. Logic stays in `lib/*.js` (unit-testable); `bin/` stays thin.
- Test and validate:
  ```bash
  npm test                                   # node --test tests/*.test.mjs — offline only
  node bin/seedloom.mjs doctor               # offline env/credential checks
  ```
- **Tests never call live BytePlus APIs** (real calls bill real money): temp `SEEDLOOM_HOME`, credential env stripped, and — once the API core lands — local fake HTTP servers. The ConsensFlow discipline.
- **No reachable stubs.** The surface is `video | tts | image | qa | status | doctor | models | config` (plus `help`); `voices`/`clone` stay unregistered until they work end to end.
- **Tests spawn the CLI asynchronously** (`spawn`, never `spawnSync`) when fake servers live in the test process — a blocking spawn freezes the event loop the fakes answer from and deadlocks the suite.
- Two medium-confidence API details remain flagged "verify live" in code comments (video param placement, the QA video content part) — confirm on the first billed Ark call and delete the comments. Ark calls currently fail with `ModelNotOpen` until each model is activated in the console (ModelArk → Model Square). TTS is fully live-verified 2026-07-05: the body nests under `req_params` (`additions` is a JSON-encoded string carrying `context_texts`), `wav` output works, and word timestamps arrive as a `sentence` field on audio chunks (`{text, words: [{word, startTime, endTime, confidence}]}`), normalized to `narration.words.json`.
- The bin's main-module guard realpaths `process.argv[1]` — global npm installs invoke it through a symlink; don't "simplify" that check back to a plain equality.

## Conventions (enforced)

- **Model IDs and endpoints live in config, never at call sites.** BytePlus rotates YYMMDD-suffixed builds; adopting Seedance 2.5 must be an edit to `~/.seedloom/config.json` (or `DEFAULT_CONFIG`), not a code change.
- **Never echo credentials.** `maskKey()` for any output that mentions a key.
- **Artifacts are local files, downloaded on success.** Generated BytePlus URLs expire in ~24h; never persist or print a bare URL as the result of a run.
- **Annotate future MCP tools** with `title` + `readOnlyHint`/`destructiveHint` from day one (hard gate for the claude.ai connectors directory later).
- Keep `AGENTS.md` and `CLAUDE.md` identical (parity test).

## Load-bearing API facts (verified 2026-07-03 — recheck before relying on them in new code)

- **Two credential domains** (BytePlus platform property, not our choice): `ARK_API_KEY` (ModelArk: video/images/LLM, `Authorization: Bearer`) vs `BYTEPLUS_VOICE_API_KEY` (Seed Speech console, sent as `X-Api-Key`). Different consoles, different headers; `doctor` checks both.
- **Video** (ModelArk): async task API `POST {ark.baseUrl}/contents/generations/tasks` → poll `GET …/tasks/{id}` → `queued|running|succeeded|failed|expired|cancelled`; result at `content.video_url` (MP4 on a TOS host, **24h TTL**), optional `content.last_frame_url` via `return_last_frame`. Video is **not** OpenAI-compatible (chat and images are).
- **Video inputs**: images accept **base64 data URLs** (<30 MB each, request body <64 MB) or HTTPS URLs; first-frame / first+last / multimodal-reference (1–9 images) are **mutually exclusive** modes; reference video is URL-only (no base64), 2–15s each, max 3; reference audio can be base64 but never alone. The international endpoint **forbids real human faces** in reference media — surface that moderation error clearly, don't retry. `generate_audio` defaults true; `watermark` defaults false; `seed` unsupported on 2.0. Individual accounts: 3 concurrent tasks (1 for 4K).
- **TTS** (Seed Speech): plain-JSON HTTP endpoint `POST {voice.baseUrl}/tts/unidirectional` with headers `X-Api-Key`, `X-Api-Resource-Id` (`seed-tts-2.0`), fixed `X-Api-App-Key: aGjiRDfUWi`; response is streamed JSON chunks with base64 audio (`{code:0,data}…{code:20000000}`) to concatenate. `enable_timestamp` returns word timestamps **only on TTS 1.0 / ICL 1.0 voices**, as a `sentence` field on audio chunks (live-verified) — for 2.0 voices derive caption timing externally (e.g. `npx hyperframes transcribe`). Resource-id routing: 2.0 voices → `seed-tts-2.0`, 1.0 (`_emo_v2_mars_`) → `volc.service_type.1000009`, cloned `S_` → `seed-icl-2.0`; a mismatched/nonexistent voice id fails with error 55000000. TTS 2.0 emotion control = `context_texts` natural-language prompts.
- **Cloning**: synthesis with a `SpeakerID` uses the normal TTS path (`seed-icl-2.0` resource). Slot ordering/status uses the management API at `open.byteplusapi.com` (Service `speech_saas_prod`, Version `2023-11-07`, ResourceID `volc.seedicl.voiceclone`) with **AK/SK HMAC-SHA256 signing** — the console UI is the no-code alternative for ordering.
- **LLM QA**: OpenAI-compatible `POST {ark.baseUrl}/chat/completions`; `seed-1-8-251228` understands video (feed a clip, ask if it matches the prompt).
- **Callbacks are unsigned** — poll; never trust `callback_url` payloads without re-fetching the task.
- **Seedance 2.5 is announced but not API-callable** (as of July 2026); 2.0 (`dreamina-seedance-2-0-260128` / `-fast-` / `-mini-260615`) is the newest callable version. docs.byteplus.com is a JS-rendered SPA — plain fetch gets nav shells; verify API details against the official SDK source (`github.com/volcengine/volcengine-python-sdk`, `github.com/vercel/ai` bytedance provider) or a browser.

## Downstream contract (HyperFrames)

Seedloom produces files; HyperFrames consumes files. A composition needs `clip.mp4` (H.264/H.265 MP4 — `<video>` as a direct child of the host root), `narration.wav|mp3`, and captions as a flat word array `[{id,text,start,end}]`. Don't fork HyperFrames' audio engine — produce compatible artifacts.

## Audience

Solo-use today, built to externalize: one repo ships the npm-installable CLI and the npx-installable universal skill; plugin/connector/MCP-registry listings remain documented later options (`docs/distribution-2026-07.md`). Keep the core clean and tool-agnostic; host-specific glue stays additive.
