import fs from "node:fs/promises";
import path from "node:path";

// Every generation run gets its own directory under ./seedloom-runs/ (ConsensFlow-run-dir
// style): artifacts + a result.json describing exactly what was asked and what came back.
// Local files are the deliverable — the HyperFrames contract.

export function runsRoot() {
  return process.env.SEEDLOOM_RUNS_DIR || path.resolve("seedloom-runs");
}

export async function createRunDir(kind) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 6);
  const dir = path.join(runsRoot(), `${stamp}-${kind}-${rand}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeResult(dir, result) {
  const file = path.join(dir, "result.json");
  await fs.writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}
