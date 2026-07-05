import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Model IDs and endpoints live in CONFIG, never at call sites: BytePlus rotates date-suffixed
// model builds (YYMMDD tails), and Seedance 2.5 is expected to land on the API imminently —
// adopting it must be an edit to ~/.seedloom/config.json (or this default map), not a code change.
export const DEFAULT_CONFIG = {
  schemaVersion: 1,
  ark: {
    // BytePlus ModelArk, international route. Auth: `Authorization: Bearer $ARK_API_KEY`.
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    videoModels: {
      standard: "dreamina-seedance-2-0-260128",
      fast: "dreamina-seedance-2-0-fast-260128",
      mini: "dreamina-seedance-2-0-mini-260615",
    },
    imageModels: {
      default: "seedream-4-5-251128",
    },
    chatModels: {
      // seed-1.8: 256k context, native video understanding — used for clip QA.
      qa: "seed-1-8-251228",
    },
  },
  voice: {
    // BytePlus Seed Speech (separate credential domain from Ark — key comes from the Speech console).
    baseUrl: "https://voice.ap-southeast-1.bytepluses.com/api/v3",
    // Fixed literal required as X-Api-App-Key by the BytePlus HTTP TTS endpoint (per official docs).
    appKey: "aGjiRDfUWi",
    resourceIds: {
      tts2: "seed-tts-2.0",
      tts1: "seed-tts-1.0",
      clone2: "seed-icl-2.0",
    },
    defaultVoice: "en_male_tim_uranus_bigtts",
    defaultFormat: "mp3",
    defaultSampleRate: 24000,
  },
};

export function configHome() {
  return process.env.SEEDLOOM_HOME || path.join(os.homedir(), ".seedloom");
}

export function configPath() {
  return path.join(configHome(), "config.json");
}

// Effective config = defaults deep-merged with ~/.seedloom/config.json (when present).
// A missing file is normal (pure defaults); an unreadable/invalid file is a loud error —
// silently ignoring a typo'd override would make the CLI use the wrong model without warning.
export async function loadConfig() {
  let raw;
  try {
    raw = await fs.readFile(configPath(), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return { config: structuredClone(DEFAULT_CONFIG), overridesFile: null };
    throw error;
  }
  let overrides;
  try {
    overrides = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${configPath()}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { config: deepMerge(structuredClone(DEFAULT_CONFIG), overrides), overridesFile: configPath() };
}

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  for (const [key, value] of Object.entries(patch)) {
    base[key] = isPlainObject(base[key]) && isPlainObject(value) ? deepMerge(base[key], value) : value;
  }
  return base;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Two independent credential domains (this is a BytePlus platform property, not our choice):
//  - ARK_API_KEY            → ModelArk: Seedance video, Seedream images, LLM chat/QA.
//  - BYTEPLUS_VOICE_API_KEY → Seed Speech console key (sent as X-Api-Key): TTS + voice cloning.
export function credentials() {
  return {
    ark: process.env.ARK_API_KEY || null,
    voice: process.env.BYTEPLUS_VOICE_API_KEY || null,
  };
}

// Show that a key is set without ever echoing it.
export function maskKey(value) {
  if (!value) return "missing";
  return value.length <= 8 ? "set" : `set (…${value.slice(-4)})`;
}
