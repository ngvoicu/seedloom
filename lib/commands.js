import fs from "node:fs/promises";
import path from "node:path";
import { credentials, loadConfig } from "./config.js";
import { generateImage, pollVideoTask, qaClip, submitVideoTask } from "./ark.js";
import { downloadTo } from "./http.js";
import { createRunDir, writeResult } from "./runs.js";
import { pcmToWav, resourceIdForVoice, synthesize } from "./voice.js";

// Generation command handlers. Every run writes local artifacts + result.json into its own
// ./seedloom-runs/<id>/ directory — local files are the deliverable (URLs expire in 24h).
// Progress goes to stderr; stdout is the human summary (or pure JSON with --json).

const FLAG_SPECS = {
  video: { valued: ["image", "last-image", "model", "res", "dur", "ratio"], multi: ["ref"], bool: ["last-frame", "no-audio", "watermark", "json"] },
  tts: { valued: ["voice", "tone", "format", "sample-rate"], multi: [], bool: ["words", "json"] },
  image: { valued: ["model", "size"], multi: [], bool: ["watermark", "json"] },
  qa: { valued: ["model"], multi: [], bool: ["json"] },
};

export function parseCommandArgs(command, args) {
  const spec = FLAG_SPECS[command];
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (spec.bool.includes(name)) {
      flags[name] = true;
    } else if (spec.valued.includes(name) || spec.multi.includes(name)) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
      if (spec.multi.includes(name)) (flags[name] ??= []).push(value);
      else flags[name] = value;
    } else {
      throw new Error(`Unknown flag --${name} for "seedloom ${command}"`);
    }
  }
  return flags;
}

function requireKey(kind) {
  const creds = credentials();
  if (kind === "ark" && !creds.ark) {
    throw new Error("ARK_API_KEY is not set — create one in the BytePlus console → ModelArk → API keys, then `export ARK_API_KEY=…` (seedloom doctor checks it).");
  }
  if (kind === "voice" && !creds.voice) {
    throw new Error("BYTEPLUS_VOICE_API_KEY is not set — activate Seed Speech in the BytePlus console and create a key, then `export BYTEPLUS_VOICE_API_KEY=…` (seedloom doctor checks it).");
  }
  return kind === "ark" ? creds.ark : creds.voice;
}

function output(flags, result, humanLines) {
  if (flags.json) return JSON.stringify(result, null, 2);
  return humanLines.join("\n");
}

export async function runVideo(args) {
  const flags = parseCommandArgs("video", args);
  const prompt = flags._[0];
  if (!prompt) throw new Error('Usage: seedloom video "<prompt>" [--image first.png] [--last-image last.png] [--ref img …] [--model standard|fast|mini] [--res 480p|720p|1080p|4k] [--dur 4-15] [--ratio 16:9] [--last-frame] [--no-audio] [--watermark] [--json]');
  const hasFrames = Boolean(flags.image || flags["last-image"]);
  if (hasFrames && flags.ref?.length) throw new Error("First/last-frame mode and reference-image mode are mutually exclusive (platform rule) — pass --image/--last-image OR --ref, not both.");
  if (flags["last-image"] && !flags.image) throw new Error("--last-image requires --image (first+last frame mode).");
  if ((flags.ref?.length ?? 0) > 9) throw new Error("At most 9 reference images.");

  const key = requireKey("ark");
  const { config } = await loadConfig();
  const tier = flags.model ?? "standard";
  const model = config.ark.videoModels[tier];
  if (!model) throw new Error(`Unknown video model tier "${tier}" — one of: ${Object.keys(config.ark.videoModels).join(", ")}`);

  const dir = await createRunDir("video");
  console.error(`run: ${dir}`);
  const taskId = await submitVideoTask(config, key, {
    prompt,
    model,
    image: flags.image,
    lastImage: flags["last-image"],
    refs: flags.ref,
    resolution: flags.res,
    duration: flags.dur,
    ratio: flags.ratio,
    audio: flags["no-audio"] ? false : undefined,
    watermark: flags.watermark,
    returnLastFrame: flags["last-frame"],
  });
  console.error(`task: ${taskId}`);
  let lastStatus = "";
  const task = await pollVideoTask(config, key, taskId, {
    onTick: (status) => {
      if (status !== lastStatus) console.error(`status: ${status}`);
      lastStatus = status;
    },
  });

  const videoUrl = task.content?.video_url;
  if (!videoUrl) throw new Error(`Task succeeded but carried no content.video_url: ${JSON.stringify(task).slice(0, 300)}`);
  const clip = await downloadTo(videoUrl, path.join(dir, "clip.mp4"));
  let lastFrame = null;
  if (task.content?.last_frame_url) {
    lastFrame = await downloadTo(task.content.last_frame_url, path.join(dir, "last_frame.png"));
  }

  const result = {
    command: "video",
    prompt,
    model,
    taskId,
    params: { resolution: flags.res ?? null, duration: flags.dur ?? null, ratio: flags.ratio ?? null, image: flags.image ?? null, lastImage: flags["last-image"] ?? null, refs: flags.ref ?? [] },
    files: { video: clip.path, lastFrame: lastFrame?.path ?? null },
    usage: task.usage ?? null,
    createdAt: new Date().toISOString(),
  };
  await writeResult(dir, result);
  return output(flags, result, [
    `clip: ${clip.path} (${(clip.bytes / 1e6).toFixed(1)} MB)`,
    ...(lastFrame ? [`last frame: ${lastFrame.path}`] : []),
    `result: ${path.join(dir, "result.json")}`,
  ]);
}

export async function runTts(args) {
  const flags = parseCommandArgs("tts", args);
  const text = flags._[0];
  if (!text) throw new Error('Usage: seedloom tts "<text>" [--voice <id|S_cloneId>] [--tone "warm, reassuring"] [--format mp3|wav] [--sample-rate 24000] [--words] [--json]');
  const key = requireKey("voice");
  const { config } = await loadConfig();
  const voice = flags.voice ?? config.voice.defaultVoice;
  const format = flags.format ?? config.voice.defaultFormat;
  if (!["mp3", "wav"].includes(format)) throw new Error(`--format must be mp3 or wav (got "${format}")`);
  const sampleRate = Number(flags["sample-rate"] ?? config.voice.defaultSampleRate);

  const dir = await createRunDir("tts");
  console.error(`run: ${dir}`);
  // wav is produced by requesting raw pcm and wrapping a RIFF header locally.
  const { audio, sentences } = await synthesize(config, key, {
    text,
    voice,
    tone: flags.tone,
    format: format === "wav" ? "pcm" : format,
    sampleRate,
    wantTimestamps: Boolean(flags.words),
  });
  const audioPath = path.join(dir, `narration.${format}`);
  await fs.writeFile(audioPath, format === "wav" ? pcmToWav(audio, sampleRate) : audio);

  let wordsPath = null;
  let wordsNote = null;
  if (flags.words) {
    // Normalize the live-verified sentence payloads to the flat HyperFrames caption contract.
    const words = sentences.flatMap((s) => s.words ?? []).map((w, i) => ({ id: i, text: w.word, start: w.startTime, end: w.endTime }));
    if (words.length > 0) {
      wordsPath = path.join(dir, "narration.words.json");
      await fs.writeFile(wordsPath, `${JSON.stringify(words, null, 2)}\n`);
    } else {
      wordsNote = `voice "${voice}" returned no native timestamps (only TTS 1.0/ICL voices provide them) — derive timing externally, e.g. \`npx hyperframes transcribe ${audioPath}\``;
    }
  }

  const result = {
    command: "tts",
    voice,
    resourceId: resourceIdForVoice(config, voice, undefined),
    tone: flags.tone ?? null,
    format,
    sampleRate,
    characters: text.length,
    files: { audio: audioPath, words: wordsPath },
    wordsNote,
    createdAt: new Date().toISOString(),
  };
  await writeResult(dir, result);
  return output(flags, result, [
    `audio: ${audioPath} (${(audio.length / 1024).toFixed(0)} KB, voice ${voice})`,
    ...(wordsPath ? [`words: ${wordsPath}`] : []),
    ...(wordsNote ? [`note: ${wordsNote}`] : []),
    `result: ${path.join(dir, "result.json")}`,
  ]);
}

export async function runImage(args) {
  const flags = parseCommandArgs("image", args);
  const prompt = flags._[0];
  if (!prompt) throw new Error('Usage: seedloom image "<prompt>" [--model <id>] [--size 2048x2048] [--watermark] [--json]');
  const key = requireKey("ark");
  const { config } = await loadConfig();
  const model = flags.model ?? config.ark.imageModels.default;

  const dir = await createRunDir("image");
  console.error(`run: ${dir}`);
  const { bytes, usage } = await generateImage(config, key, { prompt, model, size: flags.size, watermark: flags.watermark });
  const imagePath = path.join(dir, "image.png");
  await fs.writeFile(imagePath, bytes);

  const result = { command: "image", prompt, model, size: flags.size ?? null, files: { image: imagePath }, usage, createdAt: new Date().toISOString() };
  await writeResult(dir, result);
  return output(flags, result, [`image: ${imagePath} (${(bytes.length / 1024).toFixed(0)} KB)`, `result: ${path.join(dir, "result.json")}`]);
}

export async function runQa(args) {
  const flags = parseCommandArgs("qa", args);
  const [videoPath, prompt] = flags._;
  if (!videoPath || !prompt) throw new Error('Usage: seedloom qa <clip.mp4> "<the prompt it was generated from>" [--model <id>] [--json]');
  await fs.access(videoPath).catch(() => {
    throw new Error(`No such file: ${videoPath}`);
  });
  const key = requireKey("ark");
  const { config } = await loadConfig();
  const model = flags.model ?? config.ark.chatModels.qa;

  const dir = await createRunDir("qa");
  console.error(`run: ${dir}`);
  const { answer, usage } = await qaClip(config, key, { videoPath, prompt, model });
  const reviewPath = path.join(dir, "review.md");
  await fs.writeFile(reviewPath, `${answer}\n`);

  const result = { command: "qa", video: videoPath, prompt, model, files: { review: reviewPath }, usage, createdAt: new Date().toISOString() };
  await writeResult(dir, result);
  return output(flags, result, [answer, "", `review: ${reviewPath}`, `result: ${path.join(dir, "result.json")}`]);
}
