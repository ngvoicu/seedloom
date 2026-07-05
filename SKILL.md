---
name: seedloom
description: Check and configure Seedloom — the BytePlus Seed-family media CLI (Seedance video, Seed TTS voices incl. cloning, Seedream images) that produces local files for HyperFrames and other video pipelines. Use when the user mentions seedloom, wants to verify BytePlus/ModelArk/Seed Speech credentials or model IDs for it, or asks what Seedloom can do. The generation surface (video/tts/image/qa/clone) is landing next — this skill currently covers setup, diagnostics, and configuration only; do not promise generation commands yet.
---

# Seedloom

Seedloom turns BytePlus Seed-family models — **Seedance video, Seed TTS voices (incl. $2 voice cloning), Seedream images, seed-1.8 clip QA** — into **local media files** (`clip.mp4`, `narration.wav` + word-timestamps JSON, `image.png`) for coding agents and HyperFrames compositions.

**Current surface (v0):** setup, diagnostics, and configuration. The generation commands (`video / tts / image / qa / clone`) are being built spec-first — never claim or attempt them until this skill documents them.

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

- **Never invoke generation commands that this skill does not document** — they don't exist yet; the CLI rejects them.
- **Never echo credential values**; `status`/`doctor` output is already masked — relay it as printed.
- Runs are offline in v0 (`doctor` does not hit the network); a first live call after the generation core lands is what verifies account activation and quotas.
