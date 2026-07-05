# Seedloom

Generate **video, voice, and images** from your coding agent — Seedance video clips, Seed TTS narration (including $2 voice cloning), Seedream stills, and automated clip QA — as plain **local files**, ready to drop into [HyperFrames](https://hyperframes.heygen.com) compositions or any video pipeline.

Seedloom is a **zero-dependency Node CLI** over ByteDance's Seed model family on **BytePlus ModelArk** (the international platform), plus the universal skill (`SKILL.md`, same repo) — installed with `npx skills add ngvoicu/seedloom -g` into Claude Code, Codex, Cursor, Windsurf, Cline, Gemini CLI, or any tool that reads SKILL.md (Spec Mint pattern).

> **Status: v0 scaffold.** `seedloom status | doctor | models | config` work today; the generation core (`video / tts / image / qa / clone`) is being built spec-first. Everything in this README marked *(planned)* documents that target surface.

---

## What is it? (the 30-second version)

You're building a video with an AI coding agent — an explainer, a promo, a narrative piece. You need real generated media: a 10-second Seedance clip from a still frame, a narrator with a voice you cloned from 20 seconds of audio, a title-card image. Today that means consoles, aggregator markups, or gluing raw HTTP calls into every project.

Seedloom gives the agent (or you) one CLI:

1. **`seedloom video`** *(planned)* — submit a Seedance task (text, first-frame image, or reference images), poll it, and **download the MP4 immediately** (BytePlus URLs expire in 24h — a bare URL is never the result).
2. **`seedloom tts`** *(planned)* — synthesize narration with any of ~500 Seed voices or your cloned voice, with word timestamps for captions.
3. **`seedloom qa`** *(planned)* — have seed-1.8 (a video-understanding LLM) watch the generated clip and tell you whether it matches the prompt before you burn human review time.

Everything lands as local files with a `result.json` — the exact contract HyperFrames and normal video tooling consume.

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

## Install

One repo, two surfaces — usually the skill is all you need:

```bash
# Teach your AI tool to use it — the universal skill (SKILL.md in this repo):
npx skills add ngvoicu/seedloom -g                # all tools; or -a claude-code | codex | cursor

# That's the whole install: when `seedloom` is not on PATH, the skill runs it
# zero-install via `npx -y github:ngvoicu/seedloom`. For a permanent, faster CLI:
npm install -g ngvoicu/seedloom
seedloom doctor
```

Not yet on npm; both forms above pull from GitHub. Once published, they shorten to `npx skills add`, `npm i -g seedloom`, and `npx -y seedloom`.

Planned distribution: npm (`npm i -g seedloom`) + the npx universal skill are the chosen channels; Claude Code plugin/community directory, a `.mcpb` Connectors bundle, a Codex plugin, and the MCP Registry remain documented later options (see [docs/distribution-2026-07.md](docs/distribution-2026-07.md)).

## Setup — BytePlus accounts and keys

BytePlus has **two independent credential domains** (platform property, not ours). Signup is self-serve for individuals (~195 countries, credit card, personal verification):

| Env var | Where to get it | Pays for | Free trial |
|---|---|---|---|
| `ARK_API_KEY` | BytePlus console → **ModelArk** → API keys | Seedance video, Seedream images, LLM QA | per-model token grants |
| `BYTEPLUS_VOICE_API_KEY` | BytePlus console → **Seed Speech** → activate | Seed TTS, voice cloning | 20k chars + 1 cloned voice |

```bash
export ARK_API_KEY=…
export BYTEPLUS_VOICE_API_KEY=…
seedloom doctor        # checks both, with fix-it hints; runs offline
```

## Usage

Working today:

```bash
seedloom status [--json]     # config home, credentials (masked), effective models
seedloom doctor              # environment/credential checks with fix-it hints
seedloom models [--json]     # effective model IDs and where they come from
seedloom config show|path    # effective config JSON / override file location
```

Target surface *(planned — built spec-first, flags may still shift)*:

```bash
# Text-to-video, image-to-video (first frame), or reference-to-video (1-9 images)
seedloom video "a paper boat sails a rain gutter" [--image first.png] [--ref a.png b.png]
               [--model standard|fast|mini] [--res 480p|720p|1080p|4k] [--dur 4-15]
               [--last-frame]          # also saves last_frame.png for chaining clips

# Narration with stock or cloned voices; words.json for captions
seedloom tts "Welcome back. Today we ship." [--voice en_male_tim_uranus_bigtts | S_<cloneId>]
             [--tone "warm, reassuring"] [--words] [--format mp3|wav]

seedloom image "isometric server room, dusk palette"       # Seedream still (first frames, cards)
seedloom voices [--lang en]                                # browse the ~500-voice catalog
seedloom clone status|use                                  # cloned-voice lifecycle (ordering via console)
seedloom qa clip.mp4 "the prompt it came from"             # seed-1.8 watches the clip, reports mismatches
```

## Configuration

Model IDs rotate (they carry YYMMDD build suffixes) and **Seedance 2.5** — announced June 2026: 30s single-pass clips, native 4K, up to 50 references — is expected on the API imminently. So models are **config, not code**. Override anything in `~/.seedloom/config.json`:

```json
{ "ark": { "videoModels": { "standard": "dreamina-seedance-2-5-<suffix>" } } }
```

`seedloom models` shows the effective IDs and where they came from. `SEEDLOOM_HOME` relocates the config home (used by tests).

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
- Keys are never echoed (`status`/`doctor` mask them), and generation output is always downloaded to disk — URLs expire in 24h.

## Develop / test

```bash
npm test          # node --test tests/*.test.mjs — offline: temp SEEDLOOM_HOME, keys stripped, no live APIs
```

Contributor/agent guide: [AGENTS.md](AGENTS.md) (kept byte-identical with [CLAUDE.md](CLAUDE.md); a parity test enforces it). Research and distribution references live in [docs/](docs/).
