# Seedloom

[![ci](https://github.com/ngvoicu/seedloom/actions/workflows/ci.yml/badge.svg)](https://github.com/ngvoicu/seedloom/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)
![node >= 20](https://img.shields.io/badge/node-%3E%3D20-63C7B2.svg)

Generate **video, voice, and images** from your coding agent — Seedance video clips, Seed TTS narration (including $2 voice cloning), Seedream stills, and automated clip QA — as plain **local files**, ready to drop into [HyperFrames](https://hyperframes.heygen.com) compositions or any video pipeline.

One repo, two surfaces: a **zero-dependency Node CLI** over ByteDance's Seed model family on **BytePlus ModelArk** (the international platform), and the **universal skill** (`SKILL.md`) that teaches Claude Code, Codex, Cursor, Windsurf, Cline, Gemini CLI — or any tool that reads SKILL.md files — how to drive it.

> **Status: v0.2.** The generation core is implemented: `video`, `tts`, `image`, and `qa` work end to end against the verified API shapes, with a fully offline test suite (fake BytePlus servers — 21 tests). A first live call (needs keys + billing) validates the remaining account-side facts. `voices`/`clone` subcommands are deliberately absent — cloned voices already work via `tts --voice S_<cloneId>`; slot ordering happens in the console.

## Install — one command

```bash
npx skills add ngvoicu/seedloom -g          # all AI tools; or -a claude-code | codex | cursor
```

That's the whole install. When `seedloom` isn't on your PATH, the skill runs it zero-install via `npx -y github:ngvoicu/seedloom` (the CLI has zero dependencies, so this is fast).

Optionally, make the CLI permanent:

```bash
npm install -g ngvoicu/seedloom
seedloom doctor
```

Not yet on npm; both forms pull from GitHub. Once published, they shorten to `npm i -g seedloom` and `npx -y seedloom`.

## Set up your BytePlus keys

Setup and diagnostics need **no keys**. Generation needs the key for its family, and the two are **independent** — set up only what you'll use.

| Env var | Unlocks | Needed for | Free trial |
|---|---|---|---|
| `ARK_API_KEY` | Seedance **video**, Seedream **images**, seed-1.8 **clip QA** | `video`, `image`, `qa` | per-model token grants |
| `BYTEPLUS_VOICE_API_KEY` | Seed **TTS**, **voice cloning** | `tts` (incl. `--voice S_<cloneId>`) | 20k characters + 1 cloned voice |

Only making narration? You need just the voice key. Only generating clips and stills? Just the Ark key.

**Getting `ARK_API_KEY`** (video / images / QA):

1. Sign up at the [BytePlus console](https://console.byteplus.com) — self-serve for individuals (~195 countries, credit card, personal verification).
2. Open **ModelArk** → **API keys** → create a key.
3. `export ARK_API_KEY=…` (shell profile, direnv, or your secret manager).

**Getting `BYTEPLUS_VOICE_API_KEY`** (TTS / cloning):

1. Same BytePlus console → **Seed Speech** → activate the service (includes the free trial).
2. Create an API key in that console — it is a *different* key domain than ModelArk; the two are not interchangeable.
3. `export BYTEPLUS_VOICE_API_KEY=…`

**Verify** (offline, safe to run anytime):

```bash
seedloom doctor      # checks node, config, and both keys — masked, with fix-it hints
```

Keys are read from the environment only, never stored by Seedloom, and never echoed (`status`/`doctor` mask them).

## Commands

Generation — each run writes local artifacts + `result.json` under `./seedloom-runs/<id>/`:

```bash
# Text-to-video, image-to-video (first frame / first+last), or reference-to-video (1-9 images)
seedloom video "a paper boat sails a rain gutter" [--image first.png] [--last-image last.png]
               [--ref a.png b.png] [--model standard|fast|mini] [--res 480p|720p|1080p|4k]
               [--dur 4-15] [--ratio 16:9] [--last-frame] [--no-audio] [--watermark] [--json]

# Narration with stock or cloned voices; --words preserves native timestamps (TTS 1.0 voices)
seedloom tts "Welcome back. Today we ship." [--voice en_male_tim_uranus_bigtts | S_<cloneId>]
             [--tone "warm, reassuring"] [--format mp3|wav] [--sample-rate 24000] [--words] [--json]

seedloom image "isometric server room, dusk palette" [--size 2048x2048]   # Seedream still
seedloom qa clip.mp4 "the prompt it came from"       # seed-1.8 watches the clip, reports mismatches
```

Setup & diagnostics (offline, free):

```bash
seedloom status [--json]     # config home, credentials (masked), effective models
seedloom doctor              # environment/credential checks with fix-it hints
seedloom models [--json]     # effective model IDs and where they come from
seedloom config show|path    # effective config JSON / override file location
```

Deliberately not built: `voices` (no verified catalog API — browse the official voice list docs) and `clone` slot management (console UI; AK/SK-signed API deferred). Cloned voices work today via `tts --voice S_<cloneId>`.

## Why Seedloom (and not an existing tool)

Verified July 2026 (full research in [docs/research-2026-07-byteplus.md](docs/research-2026-07-byteplus.md)):

- **Nothing else covers this combination.** No first-party MCP server or CLI exists for Seedance or Seed TTS. Community MCP servers are video-only and default to the China (Volcengine) endpoint; aggregators (fal.ai, kie.ai) cost 3–5×, cap resolution at 720p, and their "TTS" is ElevenLabs. **No tool anywhere exposes Seed TTS + voice cloning to agents.**
- **Direct BytePlus is cheap.** ~$1 for a 5s 1080p Seedance 2.0 clip (fast/mini tiers cheaper), $30/M characters of TTS (a 90-second narration ≈ $0.04), $2 per cloned voice, $0.25/M-token LLM QA.
- **Local files are the deliverable.** Generated URLs expire in ~24h; Seedloom downloads on success, always.

## How it works — the flow

```text
seedloom video "storm rolling over a lighthouse" --image still.png --res 1080p --dur 8
   │
   ▼
POST {ark}/contents/generations/tasks        (image sent as base64 data URL — no hosting needed)
   │            task id
   ▼
poll GET …/tasks/{id}     queued → running → succeeded
   │
   ▼
download content.video_url  →  ./seedloom-runs/<run-id>/clip.mp4   (+ last_frame.png for chaining)
   │
   ▼
result.json (model, seed, resolution, duration, cost tokens, paths)
```

TTS is simpler still: one plain-JSON HTTP call, streamed base64 chunks concatenated to `narration.mp3|wav`, plus `narration.words.json` (word timestamps — native on TTS 1.0 voices, via Whisper transcription for the premium 2.0 voices).

## Using the output with HyperFrames

Seedloom produces exactly what a HyperFrames composition consumes — no adapter needed:

- `clip.mp4` → a `<video>` layer (place as a direct child of the host root; the framework owns playback).
- `narration.mp3|wav` → the voiceover track; `narration.words.json` (`[{id,text,start,end}]`) → captions/karaoke.
- `image.png` → stills, first frames for image-to-video, title cards.
- `last_frame.png` → the first frame of the *next* clip, for visual continuity across shots.

## Good to know (limits that shape usage)

- **Seedance 2.5 is not API-callable yet** — 2.0 (standard/fast/mini) is the newest callable version; swap via config when 2.5 lands.
- **No real human faces** in reference images/video on the international endpoint (content policy). Generated/stylized characters are fine.
- **Concurrency:** individual accounts run 3 video tasks at once (1 for 4K); ~2 QPS.
- **Premium TTS 2.0 voices return no native word timestamps** — Seedloom derives them by transcription (same approach HyperFrames uses for ElevenLabs). TTS 1.0 emotional voices have native timestamps.
- **Costs are token-based for video**: a 5s 1080p clip ≈ $1.06 standard; draft on fast/mini, finalize on standard.

## Configuration

Model IDs rotate (they carry YYMMDD build suffixes) and **Seedance 2.5** — announced June 2026: 30s single-pass clips, native 4K, up to 50 references — is expected on the API imminently. So models are **config, not code**. Override anything in `~/.seedloom/config.json`:

```json
{ "ark": { "videoModels": { "standard": "dreamina-seedance-2-5-<suffix>" } } }
```

`seedloom models` shows the effective IDs and where they came from. `SEEDLOOM_HOME` relocates the config home (used by tests).

## Develop / test

```bash
npm test          # node --test tests/*.test.mjs — offline: temp SEEDLOOM_HOME, keys stripped, no live APIs
```

Contributor/agent guide: [AGENTS.md](AGENTS.md) (kept byte-identical with [CLAUDE.md](CLAUDE.md); a parity test enforces it). Research and distribution references live in [docs/](docs/).

---

<!-- ngvoicu author section — identical across all ngvoicu repos, keep in sync -->
## AI-native toolkit

This project is part of a larger AI-native toolkit — and of a way of working your whole team can adopt: talks (["Becoming an AI Native Company"](https://ngvoicu.dev/becoming-an-ai-native-company/)), hands-on team training that teaches employees to use AI, and [AI adoption consulting for engineering teams](https://ngvoicu.dev/#consulting).

- Site: [ngvoicu.dev](https://ngvoicu.dev)
- Contact: [office@ngvoicu.dev](mailto:office@ngvoicu.dev) · +40 734 704 910

Toolkit: [Specmint](https://specmint.ngvoicu.dev) (durable AI coding specs) · [Kluris](https://kluris.ngvoicu.dev) (team knowledge brains) · [ConsensFlow](https://consensflow.ngvoicu.dev) (cross-agent second opinions)
