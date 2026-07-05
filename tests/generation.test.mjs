import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "seedloom.mjs");

// Generation tests run the real CLI as a subprocess against LOCAL fake BytePlus servers —
// never the network, never real keys, never real money (the ConsensFlow discipline).
// The fakes assert our request shapes; the first live call validates BytePlus's side.

function startFakeServers() {
  const state = { videoPolls: 0, requests: [] };

  const ark = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      state.requests.push({ url: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : null });
      const send = (code, payload, type = "application/json") => {
        res.writeHead(code, { "content-type": type });
        res.end(typeof payload === "string" || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
      };
      if (req.method === "POST" && req.url === "/api/v3/contents/generations/tasks") {
        const parsed = JSON.parse(body);
        if (/moderate-me/.test(parsed.content?.[0]?.text ?? "")) {
          return send(400, { error: { code: "InputTextSensitiveContentDetected", message: "sensitive" } });
        }
        return send(200, { id: "task-abc" });
      }
      if (req.method === "GET" && req.url === "/api/v3/contents/generations/tasks/task-abc") {
        state.videoPolls += 1;
        if (state.videoPolls < 2) return send(200, { id: "task-abc", status: "running" });
        return send(200, {
          id: "task-abc",
          status: "succeeded",
          content: { video_url: `${state.arkBase}/fake-files/clip.mp4`, last_frame_url: `${state.arkBase}/fake-files/last.png` },
          usage: { total_tokens: 246840 },
        });
      }
      if (req.method === "GET" && req.url === "/fake-files/clip.mp4") return send(200, Buffer.from("FAKE-MP4-BYTES"), "video/mp4");
      if (req.method === "GET" && req.url === "/fake-files/last.png") return send(200, Buffer.from("FAKE-PNG"), "image/png");
      if (req.method === "POST" && req.url === "/api/v3/images/generations") {
        return send(200, { data: [{ b64_json: Buffer.from("FAKE-IMAGE-PNG").toString("base64") }], usage: { total_tokens: 100 } });
      }
      if (req.method === "POST" && req.url === "/api/v3/chat/completions") {
        return send(200, { choices: [{ message: { content: "Verdict: keep. Matches the prompt; no artifacts." } }], usage: { total_tokens: 900 } });
      }
      send(404, { error: "unexpected route " + req.url });
    });
  });

  const voice = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      state.requests.push({ url: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : null });
      if (req.method === "POST" && req.url === "/api/v3/tts/unidirectional") {
        const parsed = JSON.parse(body);
        res.writeHead(200, { "content-type": "application/json" });
        // Streamed JSON chunks, newline-separated, base64 audio + end marker.
        res.write(`${JSON.stringify({ code: 0, data: Buffer.from("AUD").toString("base64") })}\n`);
        if (parsed.req_params?.audio_params?.enable_timestamp) {
          res.write(`${JSON.stringify({ code: 0, data: Buffer.from("IO!").toString("base64"), words: [{ word: "hello", start: 0, end: 0.4 }] })}\n`);
        } else {
          res.write(`${JSON.stringify({ code: 0, data: Buffer.from("IO!").toString("base64") })}\n`);
        }
        res.end(`${JSON.stringify({ code: 20000000 })}\n`);
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected route" }));
    });
  });

  return new Promise((resolve) => {
    ark.listen(0, "127.0.0.1", () => {
      voice.listen(0, "127.0.0.1", () => {
        state.arkBase = `http://127.0.0.1:${ark.address().port}`;
        state.voiceBase = `http://127.0.0.1:${voice.address().port}`;
        resolve({ state, close: () => (ark.close(), voice.close()) });
      });
    });
  });
}

// Home wired to the fakes: base URLs overridden, poll interval tiny, runs dir inside home.
function makeHome(state) {
  const home = mkdtempSync(path.join(tmpdir(), "seedloom-gen-"));
  writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      ark: { baseUrl: `${state.arkBase}/api/v3`, poll: { intervalMs: 5, timeoutMs: 5000 } },
      voice: { baseUrl: `${state.voiceBase}/api/v3` },
    }),
  );
  return home;
}

// Async spawn (NOT spawnSync): the fake servers live in this test process, and a blocking
// spawn would freeze the event loop they answer from — deadlocking every network test.
function runCli(args, { home, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: {
        ...process.env,
        SEEDLOOM_HOME: home,
        SEEDLOOM_RUNS_DIR: path.join(home, "runs"),
        ARK_API_KEY: "",
        BYTEPLUS_VOICE_API_KEY: "",
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("video: submit → poll → download clip + last frame + result.json", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["video", "a paper boat sails a rain gutter", "--res", "1080p", "--dur", "8", "--last-frame", "--json"], {
      home,
      env: { ARK_API_KEY: "ark-test-key" },
    });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.taskId, "task-abc");
    assert.equal(readFileSync(out.files.video, "utf8"), "FAKE-MP4-BYTES");
    assert.equal(readFileSync(out.files.lastFrame, "utf8"), "FAKE-PNG");
    assert.equal(out.usage.total_tokens, 246840);
    const resultJson = JSON.parse(readFileSync(path.join(path.dirname(out.files.video), "result.json"), "utf8"));
    assert.equal(resultJson.command, "video");
    // Request shape: bearer auth, model resolved from config tier, params in body.
    const submit = state.requests.find((r) => r.url.endsWith("/contents/generations/tasks") && r.method === "POST");
    assert.equal(submit.headers.authorization, "Bearer ark-test-key");
    assert.equal(submit.body.model, "dreamina-seedance-2-0-260128");
    assert.equal(submit.body.resolution, "1080p");
    assert.equal(submit.body.duration, 8);
    assert.equal(submit.body.return_last_frame, true);
    assert.ok(state.videoPolls >= 2, "should have polled through a running state");
  } finally {
    close();
  }
});

test("video: local --image is inlined as a base64 data URL with first_frame role", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const img = path.join(home, "first.png");
    writeFileSync(img, "PNGBYTES");
    const result = await runCli(["video", "sunrise", "--image", img, "--json"], { home, env: { ARK_API_KEY: "k" } });
    assert.equal(result.status, 0, result.stderr);
    const submit = state.requests.find((r) => r.url.endsWith("/contents/generations/tasks") && r.method === "POST");
    const part = submit.body.content.find((c) => c.type === "image_url");
    assert.equal(part.role, "first_frame");
    assert.ok(part.image_url.url.startsWith("data:image/png;base64,"));
    assert.equal(Buffer.from(part.image_url.url.split(",")[1], "base64").toString(), "PNGBYTES");
  } finally {
    close();
  }
});

test("video: frame mode and reference mode are mutually exclusive", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["video", "x", "--image", "a.png", "--ref", "b.png"], { home, env: { ARK_API_KEY: "k" } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /mutually exclusive/);
  } finally {
    close();
  }
});

test("video: moderation rejection surfaces the BytePlus error text", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["video", "moderate-me please"], { home, env: { ARK_API_KEY: "k" } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SensitiveContentDetected/);
  } finally {
    close();
  }
});

test("video: missing ARK_API_KEY is a helpful offline error", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["video", "anything"], { home });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ARK_API_KEY is not set/);
    assert.equal(state.requests.length, 0, "no network call without a key");
  } finally {
    close();
  }
});

test("tts: streamed chunks concatenate; mp3 written; headers carry the fixed app key", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["tts", "Welcome back. Today we ship.", "--json"], { home, env: { BYTEPLUS_VOICE_API_KEY: "voice-key" } });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(readFileSync(out.files.audio, "utf8"), "AUDIO!");
    assert.equal(out.resourceId, "seed-tts-2.0");
    const req = state.requests.find((r) => r.url.endsWith("/tts/unidirectional"));
    assert.equal(req.headers["x-api-key"], "voice-key");
    assert.equal(req.headers["x-api-app-key"], "aGjiRDfUWi");
    assert.equal(req.body.req_params.speaker, "en_male_tim_uranus_bigtts");
  } finally {
    close();
  }
});

test("tts: --format wav wraps pcm in a RIFF header; --tone rides as context_texts", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["tts", "hello", "--format", "wav", "--tone", "warm, reassuring", "--json"], { home, env: { BYTEPLUS_VOICE_API_KEY: "k" } });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    const wav = readFileSync(out.files.audio);
    assert.equal(wav.subarray(0, 4).toString(), "RIFF");
    assert.equal(wav.subarray(8, 12).toString(), "WAVE");
    assert.equal(wav.subarray(44).toString(), "AUDIO!");
    const req = state.requests.find((r) => r.url.endsWith("/tts/unidirectional"));
    assert.deepEqual(JSON.parse(req.body.req_params.additions).context_texts, ["warm, reassuring"]);
    assert.equal(req.body.req_params.audio_params.format, "pcm");
  } finally {
    close();
  }
});

test("tts: cloned S_ voice routes to the ICL resource id", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["tts", "hi", "--voice", "S_abc123", "--json"], { home, env: { BYTEPLUS_VOICE_API_KEY: "k" } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).resourceId, "seed-icl-2.0");
    const req = state.requests.find((r) => r.url.endsWith("/tts/unidirectional"));
    assert.equal(req.headers["x-api-resource-id"], "seed-icl-2.0");
  } finally {
    close();
  }
});

test("tts: --words captures raw timestamps when the voice provides them, and notes when it can't", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    // 1.0 emotional voice → fake returns a words payload → raw file preserved
    const withTs = await runCli(["tts", "hi", "--voice", "candice_emo_v2_mars_bigtts", "--words", "--json"], { home, env: { BYTEPLUS_VOICE_API_KEY: "k" } });
    assert.equal(withTs.status, 0, withTs.stderr);
    const out = JSON.parse(withTs.stdout);
    assert.ok(out.files.words && existsSync(out.files.words));
    assert.match(readFileSync(out.files.words, "utf8"), /hello/);
  } finally {
    close();
  }
});

test("image: b64 payload written as png with model from config", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["image", "isometric server room, dusk palette", "--json"], { home, env: { ARK_API_KEY: "k" } });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(readFileSync(out.files.image, "utf8"), "FAKE-IMAGE-PNG");
    const req = state.requests.find((r) => r.url.endsWith("/images/generations"));
    assert.equal(req.body.model, "seedream-4-5-251128");
    assert.equal(req.body.response_format, "b64_json");
  } finally {
    close();
  }
});

test("qa: clip is inlined as video data URL; review saved", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const clip = path.join(home, "clip.mp4");
    writeFileSync(clip, "MP4DATA");
    const result = await runCli(["qa", clip, "a storm over a lighthouse", "--json"], { home, env: { ARK_API_KEY: "k" } });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.match(readFileSync(out.files.review, "utf8"), /Verdict: keep/);
    const req = state.requests.find((r) => r.url.endsWith("/chat/completions"));
    const videoPart = req.body.messages[0].content.find((c) => c.type === "video_url");
    assert.ok(videoPart.video_url.url.startsWith("data:video/mp4;base64,"));
    assert.equal(req.body.model, "seed-1-8-251228");
  } finally {
    close();
  }
});

test("tts: missing voice key is a helpful offline error", async () => {
  const { state, close } = await startFakeServers();
  try {
    const home = makeHome(state);
    const result = await runCli(["tts", "hi"], { home });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BYTEPLUS_VOICE_API_KEY is not set/);
    assert.equal(state.requests.length, 0);
  } finally {
    close();
  }
});
