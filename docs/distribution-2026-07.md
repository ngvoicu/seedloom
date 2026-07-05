# Seedloom distribution — Claude Code, Codex, MCP ecosystems (researched 2026-07-03)

How Seedloom becomes installable-by-anyone and discoverable in official directories. All claims verified against primary sources (URLs inline).

## TL;DR

> **Current packaging choice (2026-07-03):** npm CLI (`seedloom`) + the npx-installable universal skill (`ngvoicu/seedloom-skill`, Spec Mint pattern) — no plugin manifests, no marketplace, no MCP server yet. Everything below documents the wider option space for when distribution needs grow.

Installable **today with zero gatekeepers** on all three platforms via GitHub-repo-as-marketplace + npm + the MCP Registry. Official curated directories: Claude Code has a **self-serve community marketplace** (the *official* one is Anthropic-discretionary, no application path); the **claude.ai Connectors Directory** requires a remote-hosted OAuth MCP server + Team/Enterprise org (defer); **Codex's public plugin directory is "coming soon"/closed** (prep the metadata now).

## Naming: what users see in the apps vs what the protocol is

- **Claude (desktop/claude.ai) "Connectors" settings page** = Anthropic's curated directory of *packaged MCP servers*. `Type: Web` = remote-hosted MCP (OAuth, Team/Enterprise submission); `Type: Desktop` = local MCP server, usually a one-click `.mcpb` bundle (submitted via the Local MCP Server guide); "Included" = bundled by Anthropic. Being an MCP server ≠ being in the list — the list is the curated layer on top. Seedloom's target: **Desktop connector** via `.mcpb` + local-connector submission.
- **Claude "Plugins"** (separate sidebar item) = the Claude Code plugin system (skills/commands/marketplaces) — a different surface from Connectors; seedloom targets both.
- **Codex "Plugins" page** tabs map to the tiers below: "By OpenAI" = curated/closed ("official Plugin Directory: coming soon"); "By your workspace" / "Personal" = the self-serve repo-marketplace + workspace-sharing path that works today.

## The packaging matrix

| Layer | Format | Install command (user) | Gate |
|---|---|---|---|
| CLI | npm package `seedloom` (`seedloom`) | `npm i -g seedloom` / `npx` | none (npm publish) |
| Claude Code plugin | `.claude-plugin/plugin.json` + root `skills/`, `commands/`, `.mcp.json`; repo doubles as marketplace via `.claude-plugin/marketplace.json` | `claude plugin marketplace add ngvoicu/seedloom-skill` → `claude plugin install seedloom@seedloom` | none |
| Codex plugin | `.codex-plugin/plugin.json` (only file in that dir; `skills/`, `.mcp.json`, `assets/` at root) + `interface` block (displayName, category, icon, screenshots, privacyPolicyURL) | `codex plugin marketplace add ngvoicu/seedloom-skill` | none |
| MCP server ("connector") | stdio server (`seedloom-mcp` bin) over the same `lib/` | `claude mcp add seedloom -- npx -y seedloom-mcp` · Codex: `codex mcp add …` or `~/.codex/config.toml [mcp_servers.seedloom]` | none |
| Claude Desktop one-click | `.mcpb` bundle (formerly `.dxt`): `npm i -g @anthropic-ai/mcpb` → `mcpb init` → `mcpb pack`, attach to GitHub Release (Node ships inside Claude Desktop) | double-click | none |
| MCP Registry | `"mcpName": "io.github.ngvoicu/seedloom"` in package.json → `mcp-publisher init` → `login github` → `publish` | discovery only | registry in preview; neither Claude Code nor Codex consumes it natively yet |

Sources: https://code.claude.com/docs/en/plugins-reference · https://code.claude.com/docs/en/plugin-marketplaces · https://developers.openai.com/codex/plugins/build · https://developers.openai.com/codex/mcp · https://github.com/modelcontextprotocol/mcpb · https://modelcontextprotocol.io/registry/quickstart

## Official directories

- **Claude Code community marketplace (self-serve — do this):** submit at https://clau.de/plugin-directory-submission → automated validation + safety screening → pinned to a commit SHA in `github.com/anthropics/claude-plugins-community` → users install via `/plugin install seedloom@claude-community`. Source: https://code.claude.com/docs/en/discover-plugins
- **`claude-plugins-official`:** curated at Anthropic's discretion; *no application path* ("The official marketplace is curated by Anthropic, and inclusion is at Anthropic's discretion"). Be excellent, hope for pickup.
- **claude.ai Connectors Directory** (= curated remote MCP servers): requires an internet-hosted `https://` streamable-HTTP server, OAuth 2.0 for auth, mandatory tool annotations (`title` + `readOnlyHint`/`destructiveHint`), a Team/Enterprise org to submit (portal in admin settings), docs + privacy policy + icon + reviewer test account. **Mismatched with a local API-key CLI — defer unless a hosted offering appears.** Sources: https://claude.com/docs/connectors/building/submission · https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide (local variant: https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide)
- **Codex official Plugin Directory:** "coming soon", no submission process exists today; distribute via repo marketplace / workspace sharing meanwhile. Source: https://developers.openai.com/codex/plugins/build

## Requirements that shape the code NOW

1. **API keys via plugin `userConfig` with `sensitive: true`** (routes to OS keychain) in the Claude Code manifest; env vars for Codex/config.toml. Never hardcode.
2. **Annotate every future MCP tool** with `title` + `readOnlyHint`/`destructiveHint` from day one (hard gate for the claude.ai directory later; free now). Generation tools ≠ read-only; `voices list` → `readOnlyHint: true`.
3. **`license`, `repository`, `homepage`, `keywords` in all manifests** (plugin.json ×2, package.json, server.json) + an icon (`assets/icon.png` for Codex `composerIcon`/`logo`; `icon.png` for `.mcpb`). The Codex `interface` block is store-listing metadata — fill it before their directory opens.
4. **Keep the MCP server stdio + zero-dep Node** so `.mcpb` and `npx` both just work.
5. npm name = repo name = `io.github.ngvoicu/seedloom` registry namespace for consistency.

## Rollout order

1. Build the generation core (CLI) → publish `seedloom` to npm.
2. Add universal `skills/seedloom/SKILL.md` + Claude Code plugin bits → submit to the community marketplace form.
3. Add `.codex-plugin/plugin.json` with full `interface` metadata (directory-ready for when Codex opens).
4. Add `mcp/` stdio server + `seedloom-mcp` bin → `claude mcp add` / `codex mcp add` docs → `.mcpb` release asset → MCP Registry publish.
