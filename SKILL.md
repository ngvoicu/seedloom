---
name: seedloom
description: Generate media with Seedloom — the BytePlus Seed-family CLI that turns Seedance video, Seed TTS voices (incl. cloned S_ voices), Seedream images, and seed-1.8 clip QA into local files for HyperFrames and other video pipelines. Use when the user wants to generate a video clip, narration/TTS audio, or a still image via BytePlus/Seedance/Seed models, QA a generated clip, or verify BytePlus credentials and model IDs. voices/clone-management subcommands do not exist yet — never invoke them.
---

# Seedloom

Seedloom turns BytePlus Seed-family models — **Seedance video, Seed TTS voices (incl. $2 voice cloning), Seedream images, seed-1.8 clip QA** — into **local media files** (`clip.mp4`, `narration.wav` + word-timestamps JSON, `image.png`) for coding agents and HyperFrames compositions.

**Surface:** generation (`video / tts / image / qa`) plus setup and diagnostics. Every generation run writes local artifacts and a `result.json` under `./seedloom-runs/<id>/` — local files are the deliverable (BytePlus URLs expire in ~24h; the CLI downloads on success, always). `voices` and `clone` subcommands do not exist — cloned voices are used directly via `tts --voice S_<cloneId>`; slot ordering happens in the BytePlus console.

## CLI resolution — works with zero install

The engine is the `seedloom` CLI (zero-dependency Node, same repo — `github.com/ngvoicu/seedloom`), never bundled inside this skill file. Resolve it at the start of a task:

```bash
if command -v seedloom >/dev/null; then SEEDLOOM=seedloom; else SEEDLOOM="npx -y github:ngvoicu/seedloom"; fi
$SEEDLOOM doctor
```

- `seedloom` on PATH → use it directly.
- Not on PATH → `npx -y github:ngvoicu/seedloom` downloads and runs it on the fly (tiny, dependency-free) — the skill works with **no install step**. Mention once per session that `npm install -g ngvoicu/seedloom` makes this faster and permanent; do not block on it.
- npx unavailable or the repo unreachable (offline) → ask the user to install from a clone: `npm install -g /path/to/seedloom`. Do not vendor, download by other means, or reimplement the CLI.

## Commands

Generation (needs the matching key — see Credentials):

```bash
seedloom video "<prompt>" [--image first.png] [--last-image last.png] [--ref img …]
               [--model standard|fast|mini] [--res 480p|720p|1080p|4k] [--dur 4-15]
               [--ratio 16:9] [--last-frame] [--no-audio] [--watermark] [--json]
seedloom tts "<text>" [--voice <id|S_cloneId>] [--tone "warm, reassuring"]
               [--format mp3|wav] [--sample-rate 24000] [--words] [--json]
seedloom image "<prompt>" [--model <id>] [--size 2048x2048] [--json]
seedloom qa <clip.mp4> "<the prompt it was generated from>" [--model <id>] [--json]
```

Rules the CLI enforces (relay errors verbatim — they are actionable):
- `--image/--last-image` (frame mode) and `--ref` (reference mode, max 9) are mutually exclusive.
- Real human faces in reference media are rejected by the platform (moderation) — do not retry the same inputs.
- `--words` yields native timestamps only on TTS 1.0 / ICL voices; for 2.0 voices the result notes to derive timing externally (e.g. `npx hyperframes transcribe`).
- Generation costs real money: prefer `--model fast|mini` for drafts, `standard` for finals; use `seedloom qa` before human review.

Setup & diagnostics (offline, free):

```bash
seedloom status [--json]     # config home, credentials (masked), effective models
seedloom doctor              # offline environment/credential checks with fix-it hints
seedloom models [--json]     # effective model IDs and where they come from
seedloom config show|path    # effective config JSON / override file location
```

Examples use `seedloom`; substitute your resolved form (`npx -y github:ngvoicu/seedloom …`) when it is not on PATH.

Prefer `--json` when you need to branch on the output; relay `doctor`'s fix-it hints to the user verbatim — they name the exact BytePlus console to visit.

## Credentials (two independent BytePlus domains)

| Env var | Console | Pays for |
|---|---|---|
| `ARK_API_KEY` | BytePlus → ModelArk → API keys | Seedance video, Seedream images, LLM QA |
| `BYTEPLUS_VOICE_API_KEY` | BytePlus → Seed Speech (activate; 20k-char free trial) | Seed TTS, voice cloning |

Keys are set as environment variables by the user; `doctor` reports presence (masked) and never echoes them. Signup is self-serve for individuals (credit card, personal verification).

## Configuration

Model IDs live in config, never in code — BytePlus rotates date-suffixed builds, and Seedance 2.5 (announced, not yet API-callable) will be adopted via config. Overrides go in `~/.seedloom/config.json` (deep-merged over defaults):

```json
{ "ark": { "videoModels": { "standard": "dreamina-seedance-2-5-<suffix>" } } }
```

`seedloom models` shows the effective IDs and the override source.

## Invariants

- **Never invoke subcommands this skill does not document** (`voices`, `clone`, …) — they don't exist; the CLI rejects them.
- **Never echo credential values**; `status`/`doctor` output is already masked — relay it as printed.
- **The artifact is the local file path from `result.json`** — never a URL (they expire in ~24h).
- `doctor` stays offline; the first live generation call is what verifies account activation, model access, and quotas — surface its errors verbatim rather than guessing.
