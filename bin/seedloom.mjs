#!/usr/bin/env node
// seedloom — BytePlus Seed-family media generation (Seedance video, Seed TTS, Seedream images)
// for coding agents. v0 surface: status | doctor | models | config | help. Generation commands
// (video / tts / image / qa / clone) land with the spec'd API core; unbuilt commands are not
// registered — no reachable stubs.
import process from "node:process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { configHome, configPath, credentials, loadConfig, maskKey } from "../lib/config.js";

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const command = positional[0] ?? "status";
  switch (command) {
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

Commands (v0):

  seedloom status [--json]     config home, credentials (masked), effective models
  seedloom doctor              offline environment/credential checks with fix-it hints
  seedloom models [--json]     effective model IDs and where they come from
  seedloom config show|path    effective config JSON / override file path
  seedloom help                this text

Credentials (two independent BytePlus domains):

  ARK_API_KEY               ModelArk — video, images, LLM
  BYTEPLUS_VOICE_API_KEY    Seed Speech console — TTS, voice cloning

Generation commands (video / tts / image / qa / clone) are not built yet — see docs/ and the spec.`;
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
