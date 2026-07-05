import fs from "node:fs/promises";
import path from "node:path";
import { getJson, postJson } from "./http.js";

// BytePlus ModelArk client (international route). Auth: `Authorization: Bearer $ARK_API_KEY`.
// Endpoint shapes verified against docs/research-2026-07-byteplus.md (2026-07-03); items marked
// "verify live" are medium-confidence details to confirm on the first billed call.

const IMAGE_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // per official docs: <30 MB per image
const MAX_QA_VIDEO_BYTES = 50 * 1024 * 1024; // conservative guard under the 64 MB body cap

function arkHeaders(key) {
  return { authorization: `Bearer ${key}` };
}

// Local file → base64 data URL (Seedance accepts data URLs — no hosting layer needed).
export async function imageToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error(`Unsupported image type "${ext}" (${filePath}) — use jpeg/png/webp/bmp/tiff/gif/heic`);
  const bytes = await fs.readFile(filePath);
  if (bytes.length >= MAX_IMAGE_BYTES) {
    throw new Error(`${filePath} is ${(bytes.length / 1e6).toFixed(1)} MB — BytePlus caps images at 30 MB`);
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function toImageUrl(ref) {
  return /^https?:\/\//.test(ref) ? ref : imageToDataUrl(ref);
}

// Submit a Seedance task. First-frame, first+last, and multimodal-reference are mutually
// exclusive input modes (platform rule) — callers pass exactly one of image/refs.
// Generation params ride as top-level body fields per the rendered 2.0 docs (verify live).
export async function submitVideoTask(config, key, { prompt, model, image, lastImage, refs, resolution, duration, ratio, audio, watermark, returnLastFrame }) {
  const content = [{ type: "text", text: prompt }];
  if (image) content.push({ type: "image_url", image_url: { url: await toImageUrl(image) }, role: "first_frame" });
  if (lastImage) content.push({ type: "image_url", image_url: { url: await toImageUrl(lastImage) }, role: "last_frame" });
  for (const ref of refs ?? []) {
    content.push({ type: "image_url", image_url: { url: await toImageUrl(ref) }, role: "reference_image" });
  }
  const body = {
    model,
    content,
    ...(resolution ? { resolution } : {}),
    ...(duration ? { duration: Number(duration) } : {}),
    ...(ratio ? { ratio } : {}),
    ...(audio === false ? { generate_audio: false } : {}),
    ...(watermark ? { watermark: true } : {}),
    ...(returnLastFrame ? { return_last_frame: true } : {}),
  };
  const res = await postJson(`${config.ark.baseUrl}/contents/generations/tasks`, arkHeaders(key), body);
  if (!res.id) throw new Error(`Task submit returned no id: ${JSON.stringify(res)}`);
  return res.id;
}

// Poll until terminal. Task data (and the video URL) is cleared ~24h server-side; callbacks
// are unsigned, so polling is the source of truth.
export async function pollVideoTask(config, key, taskId, { onTick } = {}) {
  const intervalMs = config.ark.poll?.intervalMs ?? 5000;
  const timeoutMs = config.ark.poll?.timeoutMs ?? 15 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await getJson(`${config.ark.baseUrl}/contents/generations/tasks/${taskId}`, arkHeaders(key));
    const status = task.status;
    onTick?.(status);
    if (status === "succeeded") return task;
    if (status === "failed" || status === "expired" || status === "cancelled") {
      const code = task.error?.code ?? "";
      const message = task.error?.message ?? JSON.stringify(task.error ?? {});
      const hint = /Sensitive/i.test(code)
        ? " (content moderation — the international endpoint forbids real human faces in reference media; do not retry the same inputs)"
        : "";
      throw new Error(`Task ${taskId} ${status}: ${code} ${message}${hint}`);
    }
    if (Date.now() >= deadline) throw new Error(`Task ${taskId} still "${status}" after ${timeoutMs / 1000}s — raise ark.poll.timeoutMs in config.json`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Seedream stills — OpenAI-compatible images endpoint; b64_json avoids a second download hop.
// The platform stamps an "AI generated" badge unless watermark:false is sent (live-observed
// 2026-07-05) — production stills can't carry it, so off is the default here, like video.
export async function generateImage(config, key, { prompt, model, size, watermark }) {
  const body = { model, prompt, response_format: "b64_json", watermark: Boolean(watermark), ...(size ? { size } : {}) };
  const res = await postJson(`${config.ark.baseUrl}/images/generations`, arkHeaders(key), body);
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Image response carried no b64_json: ${JSON.stringify(res).slice(0, 300)}`);
  return { bytes: Buffer.from(b64, "base64"), usage: res.usage ?? null };
}

// seed-1.8 clip QA — OpenAI-compatible chat with a video content part (base64 data URL).
// Live-verified 2026-07-05: the model watches the inlined clip and reviews it.
export async function qaClip(config, key, { videoPath, prompt, model }) {
  const bytes = await fs.readFile(videoPath);
  if (bytes.length >= MAX_QA_VIDEO_BYTES) {
    throw new Error(`${videoPath} is ${(bytes.length / 1e6).toFixed(0)} MB — too large to inline for QA (cap ~50 MB)`);
  }
  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "video_url", video_url: { url: `data:video/mp4;base64,${bytes.toString("base64")}` } },
          {
            type: "text",
            text:
              `This clip was generated from the prompt below. Review it: does it match the prompt? ` +
              `List artifacts (morphing, extra limbs, watermark, unreadable text), timing problems, and a keep/retry verdict.\n\nPROMPT: ${prompt}`,
          },
        ],
      },
    ],
  };
  const res = await postJson(`${config.ark.baseUrl}/chat/completions`, arkHeaders(key), body);
  const answer = res.choices?.[0]?.message?.content;
  if (!answer) throw new Error(`QA response carried no message content: ${JSON.stringify(res).slice(0, 300)}`);
  return { answer, usage: res.usage ?? null };
}
