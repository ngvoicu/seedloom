import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "seedloom.mjs");

// Every test runs against a temp SEEDLOOM_HOME with both credential env vars stripped —
// tests never read the developer's real config or keys, and never touch the network.
function runCli(args, { home, env = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SEEDLOOM_HOME: home ?? mkdtempSync(path.join(tmpdir(), "seedloom-test-")),
      ARK_API_KEY: "",
      BYTEPLUS_VOICE_API_KEY: "",
      ...env,
    },
  });
  return result;
}

test("status --json: defaults load with no config file, credentials read from env", () => {
  const result = runCli(["status", "--json"], { env: { ARK_API_KEY: "test-ark-key-1234" } });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.overridesFile, null);
  assert.equal(status.credentials.ark, true);
  assert.equal(status.credentials.voice, false);
  assert.equal(status.videoModels.standard, "dreamina-seedance-2-0-260128");
  assert.equal(status.videoModels.fast, "dreamina-seedance-2-0-fast-260128");
  assert.equal(status.defaultVoice, "en_male_tim_uranus_bigtts");
});

test("status: keys are masked, never echoed", () => {
  const secret = "sk-super-secret-value-ABCD";
  const result = runCli(["status"], { env: { ARK_API_KEY: secret } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(secret), "full key must never appear in output");
  assert.ok(result.stdout.includes("…ABCD"), "masked tail shown so the user can tell keys apart");
});

test("models --json: config file deep-merges over defaults (one override, rest intact)", () => {
  const home = mkdtempSync(path.join(tmpdir(), "seedloom-test-"));
  writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({ ark: { videoModels: { standard: "dreamina-seedance-2-5-990101" } } }),
  );
  const result = runCli(["models", "--json"], { home });
  assert.equal(result.status, 0, result.stderr);
  const models = JSON.parse(result.stdout);
  assert.equal(models.video.standard, "dreamina-seedance-2-5-990101"); // overridden
  assert.equal(models.video.fast, "dreamina-seedance-2-0-fast-260128"); // default preserved
  assert.equal(models.overridesFile, path.join(home, "config.json"));
});

test("invalid config JSON is a loud error naming the file, not a silent fallback", () => {
  const home = mkdtempSync(path.join(tmpdir(), "seedloom-test-"));
  writeFileSync(path.join(home, "config.json"), "{not json");
  const result = runCli(["status"], { home });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON in .*config\.json/);
});

test("doctor: reports missing credentials with fix-it hints, exits 0, stays offline", () => {
  const result = runCli(["doctor"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /✗ ARK_API_KEY: missing — needed for Seedance video/);
  assert.match(result.stdout, /✗ BYTEPLUS_VOICE_API_KEY: missing — needed for Seed TTS/);
  assert.match(result.stdout, /doctor runs offline/);
});

test("doctor: valid config and present credentials all green", () => {
  const home = mkdtempSync(path.join(tmpdir(), "seedloom-test-"));
  writeFileSync(path.join(home, "config.json"), JSON.stringify({ schemaVersion: 1 }));
  const result = runCli(["doctor"], { home, env: { ARK_API_KEY: "k1-abcdefgh", BYTEPLUS_VOICE_API_KEY: "k2-abcdefgh" } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes("✗"), `expected no failures, got:\n${result.stdout}`);
});

test("unknown command errors with help, exit 1", () => {
  const result = runCli(["frobnicate"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: frobnicate/);
});

test("parity: AGENTS.md and CLAUDE.md are byte-identical", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const claude = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.equal(agents, claude, "AGENTS.md and CLAUDE.md must stay identical — edit one, copy to the other");
});

test("config path respects SEEDLOOM_HOME", () => {
  const home = mkdtempSync(path.join(tmpdir(), "seedloom-test-"));
  mkdirSync(home, { recursive: true });
  const result = runCli(["config", "path"], { home });
  assert.equal(result.stdout.trim(), path.join(home, "config.json"));
});
