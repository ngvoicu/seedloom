# BytePlus × HyperFrames — Research Report

*Build or install a tool so Claude Code can generate Seedance videos + Seed TTS voices and feed them into HyperFrames compositions.*

**Date:** 2026-07-03 · **Method:** 3 orchestrated research waves (~40 agents, ~2.5M tokens): 5-domain web sweep → 26 adversarial fact-checks against primary sources (official docs, SDK source code, npm/PyPI registries) → completeness critique → gap-fill. Local audit of the existing `byteplus` skill, the HyperFrames plugin internals, and the `ai-video-production` workflow.

---

## TL;DR

1. **Nothing you can install covers your use case.** There is **no first-party MCP server or CLI** from ByteDance/BytePlus/Volcengine for Seedance or Seed TTS. Community/aggregator MCPs cover **video only** (and either default to the China endpoint or cost 3–5× via resellers). **Nothing anywhere exposes Seed TTS + voice cloning to an agent.** That half is build-only.
2. **You already own a head start:** the `byteplus` skill (`~/.claude/skills/byteplus/`, also copied at `~/.agents/skills/`) is a solid API reference from May 2026 — but it's **reference-only (no tool)** and now stale on ~6 load-bearing facts (pricing, model list, cloning ResourceID, the new HTTP TTS endpoint).
3. **Seedance 2.5 exists but is not yet API-callable** (announced June 23, 2026 at FORCE; live only in the consumer Dreamina app; every API provider shows "coming soon", public API expected imminently). **Seedance 2.0 is the newest callable version** — and it just got a native-4K API upgrade. Build against 2.0 with **model IDs in config, not code**, and swap in 2.5 the week it lands.
4. **The build just got much easier than it was in May:** BytePlus published a **plain-JSON HTTP TTS endpoint** (no more mandatory binary-WebSocket framing), and Seedance accepts **base64 data-URL images** (no public-hosting layer needed for first frames/references). A **zero-dependency Node CLI** — your proven ConsensFlow architecture — can cover video + image + TTS + cloning + LLM QA with nothing but `fetch`.
5. **Recommendation: build a small zero-dep Node CLI + skill** (working name: `seedloom`) that writes **local files** (mp4 / png / wav + word-timestamps JSON) — exactly the contract HyperFrames and your `ai-video-production` workflow already consume. Optionally wrap it in a thin MCP server later. Details in §6.

---

## 1. Model landscape (verified July 2026)

### Seedance 2.5 — announced, not callable

| Fact | Status |
|---|---|
| Announced **June 23, 2026** at Volcano Engine FORCE 2026 (with Seedream 5.0 Pro, Seed-Audio 1.0, Doubao 2.1 Pro) | confirmed |
| **30s native single-pass** video (scene changes, tempo shifts, "no stitching"), **native 4K 10-bit**, up to **50 multimodal references**, better multi-shot continuity, ~20% better prompt adherence | press claims, not API-verified |
| Live **only in Dreamina/CapCut consumer app** (30s standard, 180s "beta" mode that appears app-level stitched) | confirmed |
| **No public API anywhere** — BytePlus/Volcengine docs list no 2.5 model ID; fal.ai, Replicate, Kie.ai, WaveSpeed all show "coming soon". A July 2 source confirms closed enterprise beta, no public signup | confirmed |
| Circulating IDs like `dreamina-seedance-2-5` are **invented** (real IDs carry a YYMMDD suffix) | confirmed |
| Expected public window: "early July 2026" — industry expectation, not a committed date | unconfirmed |

**Consequence:** build now against 2.0; keep model IDs in a config file; re-check `docs.byteplus.com/en/docs/ModelArk/1159178` (Model releases) and fal/Replicate `bytedance` pages — 2.5 may land mid-build.

### Seedance 2.0 — the build target (BytePlus ModelArk, international)

- **Endpoint** (confirmed from official SDK source): `POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks` → `{id}` → poll `GET …/tasks/{task_id}` → `queued → running → succeeded | failed | expired | cancelled`. Auth: `Authorization: Bearer $ARK_API_KEY`.
- **Model IDs** (suffix = YYMMDD release date; keep in config):
  - `dreamina-seedance-2-0-260128` (standard) — confirmed
  - `dreamina-seedance-2-0-fast-260128` (fast) — confirmed
  - `dreamina-seedance-2-0-mini-260615` (mini, cheaper, June 2026) — on the ModelArk model list per salvage report; ID itself verified only via secondary sources
  - There is **no** `…-2-0-pro-…` ID — "Pro" tiering is marketing over standard + resolution. Seedance 1.x uses a **bare `seedance-` prefix** (`seedance-1-5-pro-251215` etc.). China/Volcengine uses `doubao-` prefixed twins — don't mix routes.
- **Parameters** (from rendered official docs): `ratio` (16:9, 4:3, 1:1, 3:4, 9:16, 21:9, **adaptive** = default), `resolution` (**480p / 720p(default) / 1080p / 4k**, 4K = 10-bit — the 4K tier landed at the same FORCE event), `duration` 4–15s or −1 auto (default 5), `generate_audio` (**default true** — native synced audio), `watermark` (**default false**), `return_last_frame` → `content.last_frame_url` (for clip chaining), `callback_url`, `camera_fixed`, draft tasks. `seed` is **not supported on 2.0**.
- **Input constraints** (architecture-deciding, from rendered official docs):
  - **Images accept base64 data URLs** (or HTTPS URL, or asset ID) — jpeg/png/webp/bmp/tiff/gif/heic/heif, <30 MB each, request body <64 MB, width/height 300–6000px, AR 0.4–2.5. First-frame (1), first+last (2), or multimodal reference (**1–9 images**) — the three modes are **mutually exclusive**.
  - **Reference video: URL or asset ID only, no base64** — mp4/mov (H.264/H.265), 2–15s each, max 3, total ≤15s, ≤200 MB. Reference audio: base64 OK, wav/mp3, 2–15s, max 3, and cannot be the only reference.
  - **Content policy: the international (ap-southeast) endpoint forbids real human faces in reference images/videos.** Moderation failures: synchronous 400 (`Input*SensitiveContentDetected`) at submit, or `status:"failed"` + `error.code` for output moderation.
- **Output:** `content.video_url` — an **MP4 on a TOS URL that expires in 24h** (task data cleared after 24h; no re-download API). **The tool must download immediately on success.** Callbacks are **unsigned** — poll, or verify any callback by re-calling Retrieve.
- **Limits (individual account):** 3 concurrent non-4K tasks, 1 concurrent 4K (from docs); ~2 QPS (secondary source).
- **Pricing — changed since May:** now **token-based**: resource packs ≈ **$4.30/1M tokens** (standard) / **$3.30/1M** (fast), pay-as-you-go overflow. Real-world anchor from official docs example: a 5s 1080p clip consumed **246,840 tokens ≈ $1.06** (standard). The old "$0.39–0.86 per video" figures in the local skill are stale. Direct ModelArk is roughly **3–5× cheaper than fal.ai** ($1.50 per 5s at 720p, and fal caps at 720p).

### Seedream (images — first frames / stills)

- `seedream-4-0-250828` and `seedream-4-5-251128` (aliases `seedream-4.0` / `seedream-4.5`), **OpenAI-compatible** `POST /api/v3/images/generations`, up to 10 reference images, ~$0.035–0.045/image. Seedream 5.0 Pro announced June 23 but not confirmed on the API. Note: your `ai-video-production` workflow currently standardizes on GPT Image 2 via the Codex login (the `@pygmalion` path) — Seedream is an optional same-key alternative, not a required switch.

### Seed Speech TTS + Voice Replication ("cool voices")

- **TTS 2.0 is still the flagship** (`X-Api-Resource-Id: seed-tts-2.0`). No 2.5/3.0. ~**500+ stock voices** (authoritative list: `docs.byteplus.com/en/docs/byteplusvoice/voicelist`, updated June 29, 2026): TTS 2.0 voices = `*_uranus_bigtts` (multilingual standouts: Vivi, Jess, Pinky), TTS 1.0 emotional voices = `*_emo_v2_mars_bigtts` with per-voice emotion tags (Candice, Serena, Glen, Sylus, Corey…). TTS 2.0 emotion control = **natural-language prompts** via `context_texts` ("Deliver this in a warm, reassuring tone"); TTS 1.0 = `emotion`/`emotion_scale` params.
- **NEW: plain-JSON HTTP endpoint (published since May)** — `POST https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/unidirectional`. Headers: `X-Api-Key` (Speech-console key), `X-Api-Resource-Id`, `X-Api-App-Key: aGjiRDfUWi` (fixed literal). Response = streaming JSON chunks with base64 audio to concatenate (`{code:0,data:"<b64>"}…{code:20000000}`). **Callable with plain `fetch` — no binary framing, no SDK.** (The WebSocket bidirectional endpoint still exists for realtime; it's the one with the custom binary protocol.)
- **Word timestamps:** `enable_timestamp` (in `audio_params`) returns **word + phoneme timestamps — but only for TTS 1.0 / ICL 1.0 voices**. TTS 2.0 voices return none → derive caption timing with `hyperframes transcribe` (Whisper), which is **exactly what HyperFrames already does for ElevenLabs and Kokoro** — a solved problem, not a blocker. (Exact timestamp JSON schema undocumented — confirm on first live call with a 1.0 voice.)
- **Formats:** mp3 / ogg_opus / pcm; HTTP unidirectional effectively up to 24kHz, WebSocket up to 48kHz. Long narration = per-sentence synthesis + concatenation (text limit exists but the number is unpublished; error `40402003`).
- **Voice cloning (Voice Replication 2.0, `seed-icl-2.0`):** clone from ~14–30s of clean audio → persistent `SpeakerID` usable in any TTS call. **Self-serve, $2/voice (permanent) + $30/M chars synthesis**; single-slot purchase appears allowed; trial = 1 free voice + 20k chars. Slot ordering/status uses the management API at `open.byteplusapi.com` (**AK/SK HMAC-SHA256 signing** — the one genuinely annoying auth path; ordering can be done in the console UI instead). **Correction vs the local skill: the ordering ResourceID is now `volc.seedicl.voiceclone`** (not `volc.megatts.voiceclone`). Caveat (unconfirmed): commercial cloning may trigger a manual verification step (deepfake prevention).
- **Pricing dropped since May:** PAYG **$30/M characters** (was $45); 100K prepaid $2.80; free trial 20k chars; 10 free concurrent, +$10/QPS/mo. A 90s narration ≈ 1,300 chars ≈ **$0.04**.
- **Seed Audio 1.0** (announced June 23): unified voice+music+SFX generation, zero-shot cloning, up to ~2min audio, ~$0.18/min — **application/invite only, not yet a self-serve BytePlus API**. Watch it; don't build on it.

### LLMs (the "leverage their LLMs" part)

- **OpenAI-compatible**: point any OpenAI SDK at `base_url=https://ark.ap-southeast.bytepluses.com/api/v3` with `ARK_API_KEY` — `/chat/completions`, `/embeddings`, `/images/generations`, `/responses`. Function calling, structured output (beta), streaming, batch (~50% off), context caching (~$0.05/M cache-hit).
- **Catalog:** `seed-1-6-250915` and `seed-1-8-251228` (256k context, thinking modes, **native video + image + audio understanding**, $0.25/M in / $2.00/M out ≤128k — far below GPT/Claude flagship pricing), `skylark-pro`, hosted `kimi-k2-thinking`, DeepSeek v3.x, `gpt-oss-120b`, `skylark-embedding-vision`. A "Dola-Seed-2.0" family (incl. `-code`) is appearing (SWE-bench ~76.5% — credible, not frontier).
- **Killer feature for this pipeline:** seed-1.6/1.8 **watch video** → automated QA of generated Seedance clips ("does this clip match the prompt? artifacts?") before you spend human review time — and cheap script/prompt generation for scene planning.
- **Anthropic-compatible coding endpoint** (medium confidence): BytePlus "Coding Plan" exposes `https://ark.ap-southeast.bytepluses.com/api/coding` for Anthropic-protocol tools — official docs exist for pointing **Claude Code itself** at it via `ANTHROPIC_BASE_URL` (Lite tier reportedly ~$10/mo). Also: a ConsensFlow participant on BytePlus models becomes possible.
- **Credential caveat** (one report overclaimed): `ARK_API_KEY` spans chat + images + video, but **Seed Speech TTS/cloning uses separate Speech-console credentials** (`X-Api-Key`, App ID/Access Token, AK/SK for slot management). Two credential domains, not one.

### Onboarding (individual dev, Romania) — viable

Self-serve 3-step signup with a **personal verification path** (docs: "including personal and enterprise verification"); Romania is explicitly on the ~195-country availability list; Visa/MasterCard/Amex/PayPal; no minimum spend. Seedance activation is self-serve in the ModelArk console (no allowlist); the Speech console (TTS + cloning) is self-serve too. Free trials: TTS 20k chars, cloning 1 voice + 20k chars; ModelArk LLM free-token grants (commonly cited 500k/LLM, 2M/vision) are **not primary-confirmed**. The org-only "real-name registration" regime applies only to China-mainland nodes, not ap-southeast. No first-person solo-dev writeups were found — expect some rough edges.

---

## 2. What already exists (install options) — and why none fits

| Option | What it gives | Why it falls short |
|---|---|---|
| **volcengine/mcp-server** (official monorepo, 100+ servers) | cloud infra, VOD editing, imageX | **No Seedance, no TTS.** ModelArk's "MCP" feature is a *client* (Responses API consuming MCP servers), not a server |
| **leonaiuv/seedance-2-mcp** (Node, `npx seedance-2-mcp`) | 3 tools: create/check task, direct Ark API | China-default (`ark.cn-beijing.volces.com`, `doubao-*` IDs) — needs base-URL **and** model-ID patching for BytePlus; video only; ~5 stars/3 commits; returns 24h URLs (no download) |
| **@aeromechanic/volcengine-video-mcp** (npm 1.5.5) | Claude Code-targeted video MCP | **Seedance 1.5 Pro only**, China Volcengine, needs manual Endpoint ID |
| **fal.ai official MCP** (`claude mcp add --transport http fal-ai https://mcp.fal.ai/mcp --header "Authorization: Bearer $FAL_KEY"`) | Official Seedance 2.0 host; 9 model-agnostic tools incl. submit_job/check_job/upload_file | **3–5× cost, 480p/720p only**, returns hosted URLs (still need a download step), TTS = ElevenLabs not Seed, no cloning |
| **felores/kie-ai-mcp-server / @felores/kie-cli** (npm, ships a Claude Code skill) | Seedance/Seedream/Veo3/Kling aggregator, server-side polling (`wait_for_task`), free key | Aggregator markup; TTS = ElevenLabs; no Seed voices/cloning |
| **AceDataCloud SeedanceMCP** (`uvx mcp-seedance`, hosted MCP w/ OAuth) | Seedance 2.0/fast/mini + 1.5/1.0, active (v2026.7.2.1) | Aggregator (own billing), video only |
| **WaveSpeed CLI + MCP** (`npm i -g @wavespeed/cli`, agent-native, ships SKILL.md) | Seedance 2.0 incl. video-edit | Aggregator, video only |
| **doubao-tts-mcp / doubao-speech (pip)** | Volcengine China TTS | China creds, **no cloning**, not BytePlus |
| **SDKs, not tools:** `volcengine-python-sdk[ark]` v5.0.37 (official Python; `client.content_generation.tasks`), **`@ai-sdk/bytedance` v2.0.6** (first-party Vercel AI SDK provider, `experimental_generateVideo`, targets BytePlus, encodes images as base64) | good reference implementations | libraries — still need the CLI/skill/MCP layer, and neither touches Seed TTS |

**Bottom line:** for *video-only, fastest-possible-start*, `fal.ai` MCP or `kie-cli` works today at a 3–5× premium. For the actual goal — **Seedance + Seed voices + cloning + LLM QA, cheap, producing local files for HyperFrames** — nothing exists. Build.

---

## 3. What you already have locally

- **`byteplus` skill** (`~/.claude/skills/byteplus/SKILL.md`, identical copy in `~/.agents/skills/`) — good API reference, **no tool behind it**. Stale items found by this research: TTS pricing ($45→**$30**/M + all package prices), Seedance pricing model (per-video → **token-based**), model list (missing `mini`, missing 1.x `seedance-` prefix split, no 2.5 status), cloning ResourceID (`volc.megatts.voiceclone` → **`volc.seedicl.voiceclone`**), missing the **HTTP unidirectional TTS endpoint** (it says "docs not yet published"), missing `enable_timestamp` and its TTS-1.0-only limitation, missing base64 image-input support and the no-real-faces policy.
- **HyperFrames** (official plugin 0.7.18): compositions consume **plain local files** — `<video>`/`<audio>` as direct children of the host root, captions from a flat word array `[{id,text,start,end}]` produced by `npx hyperframes transcribe`. The audio engine's TTS provider chain (HeyGen → ElevenLabs → Kokoro) is **hardcoded in the plugin** — don't fork it; a BytePlus tool should simply produce wav + words.json the same way the ElevenLabs path does (synthesize → transcribe).
- **`ai-video-production` skill** (yours): already defines the generated-clips workflow — stills (GPT Image 2) → image-to-video handoff (Flow/Veo today) → archive raw MP4 → inspect → integrate; voice bible for premium voices; captions programmatic. **Seedance slots in as a drop-in alternative to the Flow/Veo upgrade layer** (with a first-frame handoff and `return_last_frame` for continuity chaining), and Seed TTS as a premium-voice provider. No changes to HyperFrames needed — the new tool just has to write files.

---

## 4. Recommended build: `seedloom` — zero-dep Node CLI + skill

Follow the ConsensFlow architecture you already trust (plain Node ESM, `bin/*.mjs` + `lib/*.js`, zero dependencies, PATH-shim-tested, skill + optional slash commands):

```
seedloom/
  bin/seedloom.mjs               # CLI entry
  lib/config.js            # ~/.seedloom/config.json — model IDs, defaults (IDs are config, never code)
  lib/ark.js               # Bearer-auth Ark client: video tasks (submit/poll/download), images, chat
  lib/voice.js             # Speech client: HTTP unidirectional TTS (base64 chunk concat), voices, cloning status
  lib/signing.js           # AK/SK HMAC-SHA256 (only for clone-slot management; ~50 lines, defer if console UI suffices)
  skills/seedloom/SKILL.md # when/how the agent uses it (+ update the existing byteplus reference skill)
```

Subcommands (each writes **local artifacts** + a `result.json`, ConsensFlow-run-dir style):

| Command | What it does |
|---|---|
| `seedloom video "<prompt>" [--image first.png] [--ref a.png b.png] [--model std\|fast\|mini] [--res 1080p] [--dur 8] [--last-frame]` | submit → poll → **download mp4 immediately** (24h TTL); base64-encodes local images (<30MB); saves `last_frame.png` for chaining |
| `seedloom image "<prompt>"` | Seedream via OpenAI-compatible endpoint (optional — GPT Image 2 remains your default) |
| `seedloom tts "<text>" [--voice en_male_tim_uranus_bigtts] [--tone "warm, reassuring"] [--words]` | HTTP unidirectional; writes wav/mp3; `--words` → timestamps for 1.0 voices, else chains `hyperframes transcribe` → `narration.words.json` |
| `seedloom voices [--lang en] / seedloom clone status\|use` | voice catalog; cloning: synthesis by SpeakerID day one; slot ordering via console (AK/SK signing later) |
| `seedloom qa clip.mp4 "<prompt it was generated from>"` | seed-1.8 video-understanding review of a generated clip (artifacts, prompt match) |
| `seedloom doctor / seedloom status` | key checks (ARK_API_KEY + Speech key), model-config freshness, quota hints |

**Why CLI+skill first, MCP later (if ever):** it matches how you and your skills already work (Bash-driven, cross-harness — the `~/.agents/skills` copy works in non-Claude harnesses where MCP config differs); artifacts are local files, which is the HyperFrames contract; it's testable with PATH-shimmed fakes like ConsensFlow; and a thin MCP wrapper over the same lib can be added in a day if you later want it in claude.ai/desktop. The async-task pattern also fits an agent loop naturally (submit → stream progress → download), the same foreground-streaming philosophy as `cf run`.

**Estimated cost of a typical HyperFrames-integrated piece** (60s video = 6–8 Seedance clips + narration): clips ~$4–8 (standard, 1080p) or ~$1–2 (fast/mini drafts), narration ~$0.04, QA calls ~$0.01. Draft on fast/mini, finalize on standard.

---

## 5. Risks & open questions

1. **Seedance 2.5 API may land mid-build** — mitigated by config-driven model IDs; the 2.0 request shape is expected to carry over (roles/params unconfirmed for 2.5).
2. **No real human faces** in reference images/video on the international endpoint — constrains character-continuity workflows (generated/stylized characters are fine; photo-real actors are not).
3. **TTS 2.0 returns no word timestamps** — use the transcribe chain (already standard in HyperFrames); or use TTS 1.0 emotional voices when native timing matters.
4. **24h URL expiry** — the tool must download-on-success, never store URLs.
5. **Unsigned callbacks** — poll; don't build on `callback_url` for correctness.
6. **Two credential domains** (ARK_API_KEY vs Speech console keys) + AK/SK signing for clone-slot admin — doctor command should check both.
7. **Unconfirmed:** ModelArk free-token grant amounts; voice-clone slot price beyond $2/voice claim (primary-confirmed at $2 on one rendered page, marked medium); commercial-cloning manual verification; exact TTS text-length cap; exact timestamp payload schema; Coding Plan pricing. First live calls should verify these — cheap to do once signed up.
8. **Docs are a JS-rendered SPA** — WebFetch can't read them; this research used rendered copies + SDK source. For future maintenance, verify against the SDK repos or use a browser.

## 6. Suggested next steps

1. **Decide install-vs-build** (recommendation: build `seedloom`; optionally `claude mcp add` fal.ai in the meantime if you want to play with Seedance 2.0 today at markup).
2. **Sign up + activate** (self-serve): ModelArk (Seedance/LLM) + Speech console (TTS trial, 1 free cloned voice) — verifies the onboarding unknowns in ~30 min.
3. **Refresh the `byteplus` skill** with this report's corrections (both copies).
4. **Forge a spec** (specmint) for `seedloom` covering the CLI, the two auth domains, the HyperFrames handoff contract, and fake-endpoint tests.
5. **Watch for Seedance 2.5 GA** and Seed Audio 1.0 self-serve access.
