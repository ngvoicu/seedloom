#!/usr/bin/env node
// seedloom — BytePlus Seed-family media generation (Seedance video, Seed TTS, Seedream images)
// for coding agents. Surface: video | tts | image | qa | status | doctor | models | config | help.
// voices/clone remain unregistered until they work end to end — no reachable stubs.
import process from "node:process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { configHome, configPath, credentials, loadConfig, maskKey } from "../lib/config.js";
import { runImage, runQa, runTts, runVideo } from "../lib/commands.js";

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const command = positional[0] ?? "status";
  const rest = args.slice(args.indexOf(command) + 1);
  switch (command) {
    case "video":
      return console.log(await runVideo(rest));
    case "tts":
      return console.log(await runTts(rest));
    case "image":
      return console.log(await runImage(rest));
    case "qa":
      return console.log(await runQa(rest));
    case "status":
      return console.log(await renderStatus(json));
    case "doctor":
      return console.log(await renderDoctor());
    case "models":
      return console.log(await renderModels(json));
    case "config":
      return console.log(await renderConfig(positional[1] ?? "show"));
    case "help":
      return console.log(helpText());
    default:
      throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
  }
}

async function renderStatus(json) {
  const { config, overridesFile } = await loadConfig();
  const creds = credentials();
  if (json) {
    return JSON.stringify(
      {
        configHome: configHome(),
        overridesFile,
        credentials: { ark: Boolean(creds.ark), voice: Boolean(creds.voice) },
        videoModels: config.ark.videoModels,
        imageModels: config.ark.imageModels,
        chatModels: config.ark.chatModels,
        defaultVoice: config.voice.defaultVoice,
      },
      null,
      2,
    );
  }
  return [
    "# seedloom status",
    "",
    `Config home: ${configHome()}`,
    `Config overrides: ${overridesFile ?? "none (built-in defaults)"}`,
    `ARK_API_KEY (video/images/LLM): ${maskKey(creds.ark)}`,
    `BYTEPLUS_VOICE_API_KEY (TTS/cloning): ${maskKey(creds.voice)}`,
    `Video models: standard=${config.ark.videoModels.standard} fast=${config.ark.videoModels.fast} mini=${config.ark.videoModels.mini}`,
    `Image model: ${config.ark.imageModels.default}`,
    `QA model: ${config.ark.chatModels.qa}`,
    `Default voice: ${config.voice.defaultVoice}`,
  ].join("\n");
}

async function renderDoctor() {
  const lines = ["# seedloom doctor", ""];
  const [major] = process.versions.node.split(".").map(Number);
  lines.push(`${major >= 20 ? "✓" : "✗"} node ${process.versions.node}${major >= 20 ? "" : " — Node >= 20 required"}`);

  let configLine;
  try {
    const { overridesFile } = await loadConfig();
    configLine = overridesFile ? `✓ config: ${overridesFile} (valid)` : `✓ config: built-in defaults (no ${configPath()})`;
  } catch (error) {
    configLine = `✗ config: ${error instanceof Error ? error.message : String(error)}`;
  }
  lines.push(configLine);

  const creds = credentials();
  lines.push(
    creds.ark
      ? `✓ ARK_API_KEY: ${maskKey(creds.ark)}`
      : "✗ ARK_API_KEY: missing — needed for Seedance video, Seedream images, and LLM QA. Create one in the BytePlus console → ModelArk → API keys (self-serve).",
  );
  lines.push(
    creds.voice
      ? `✓ BYTEPLUS_VOICE_API_KEY: ${maskKey(creds.voice)}`
      : "✗ BYTEPLUS_VOICE_API_KEY: missing — needed for Seed TTS and voice cloning. Create one in the BytePlus console → Seed Speech (activate the service; 20k-char free trial).",
  );

  lines.push("", "doctor runs offline — a first live call is what verifies account activation, model access, and quotas.");
  return lines.join("\n");
}

async function renderModels(json) {
  const { config, overridesFile } = await loadConfig();
  const models = {
    video: config.ark.videoModels,
    image: config.ark.imageModels,
    chat: config.ark.chatModels,
    overridesFile,
  };
  if (json) return JSON.stringify(models, null, 2);
  return [
    "# seedloom models (effective)",
    "",
    `Source: built-in defaults${overridesFile ? ` + ${overridesFile}` : ""}`,
    "",
    ...Object.entries(config.ark.videoModels).map(([tier, id]) => `- video.${tier}: ${id}`),
    `- image.default: ${config.ark.imageModels.default}`,
    `- chat.qa: ${config.ark.chatModels.qa}`,
    "",
    "Model IDs carry YYMMDD build suffixes and rotate; Seedance 2.5 is not yet API-callable (July 2026).",
    `Override any ID in ${configPath()} — never in code.`,
  ].join("\n");
}

async function renderConfig(sub) {
  if (sub === "path") return configPath();
  if (sub === "show") {
    const { config } = await loadConfig();
    return JSON.stringify(config, null, 2);
  }
  throw new Error("Usage: seedloom config [show|path]");
}

function helpText() {
  return `# seedloom

BytePlus Seed-family media generation for coding agents:
Seedance video, Seed TTS voices (incl. cloning), Seedream images, seed-1.8 clip QA.

Generation (each run writes local files + result.json under ./seedloom-runs/<id>/):

  seedloom video "<prompt>" [--image first.png] [--last-image last.png] [--ref img …]
                 [--model standard|fast|mini] [--res 480p|720p|1080p|4k] [--dur 4-15]
                 [--ratio 16:9] [--last-frame] [--no-audio] [--watermark] [--json]
  seedloom tts "<text>" [--voice <id|S_cloneId>] [--tone "warm, reassuring"]
                 [--format mp3|wav] [--sample-rate 24000] [--words] [--json]
  seedloom image "<prompt>" [--model <id>] [--size 2048x2048] [--json]
  seedloom qa <clip.mp4> "<prompt it was generated from>" [--model <id>] [--json]

Setup & diagnostics:

  seedloom status [--json]     config home, credentials (masked), effective models
  seedloom doctor              offline environment/credential checks with fix-it hints
  seedloom models [--json]     effective model IDs and where they come from
  seedloom config show|path    effective config JSON / override file path
  seedloom help                this text

Credentials (two independent BytePlus domains — set only what you use):

  ARK_API_KEY               ModelArk — video, images, LLM QA
  BYTEPLUS_VOICE_API_KEY    Seed Speech console — TTS (cloned voices work via tts --voice S_<id>)

voices/clone subcommands are not built yet (no verified catalog API; slot ordering = console).`;
}

// Run only when invoked as the CLI entry point, so tests can import the render helpers.
// realpath both sides: global npm installs invoke the bin through a symlink, where
// import.meta.url (real path) never equals process.argv[1] (symlink path).
const invokedAsMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (invokedAsMain) {
  try {
    await main();
  } catch (error) {
    console.error(`seedloom error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export { renderDoctor, renderModels, renderStatus };
