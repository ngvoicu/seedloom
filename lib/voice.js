import { postStream } from "./http.js";

// BytePlus Seed Speech — the plain-JSON HTTP unidirectional TTS endpoint (no WebSocket,
// no binary framing). Headers: X-Api-Key (Speech-console key), X-Api-Resource-Id,
// X-Api-App-Key (fixed literal from official docs). Response is a stream of JSON chunks
// carrying base64 audio: {code:0,data:"…"} repeated, then {code:20000000} as the end marker.
// Request shape live-verified 2026-07-05 (rendered docs + a real call); the timestamp payload
// schema remains undocumented — whatever arrives is preserved raw (verify with a 1.0 voice).

export function resourceIdForVoice(config, voice, override) {
  if (override) {
    const id = config.voice.resourceIds[override];
    if (!id) throw new Error(`Unknown TTS resource "${override}" — one of: ${Object.keys(config.voice.resourceIds).join(", ")}`);
    return id;
  }
  if (voice.startsWith("S_")) return config.voice.resourceIds.clone2; // cloned SpeakerID
  if (voice.includes("_emo_v2_mars_")) return config.voice.resourceIds.tts1; // 1.0 emotional voices (native timestamps)
  return config.voice.resourceIds.tts2;
}

export async function synthesize(config, key, { text, voice, tone, format, sampleRate, wantTimestamps }) {
  // Body shape live-verified 2026-07-05 against the rendered official docs: everything nests
  // under req_params; `additions` is a JSON-ENCODED STRING (platform quirk), and TTS 2.0
  // tone control (context_texts) lives inside it.
  const body = {
    req_params: {
      text,
      speaker: voice,
      audio_params: {
        format,
        sample_rate: sampleRate,
        ...(wantTimestamps ? { enable_timestamp: true } : {}),
      },
      ...(tone ? { additions: JSON.stringify({ context_texts: [tone] }) } : {}),
    },
  };
  const stream = await postStream(`${config.voice.baseUrl}/tts/unidirectional`, {
    "x-api-key": key,
    "x-api-resource-id": resourceIdForVoice(config, voice, undefined),
    "x-api-app-key": config.voice.appKey,
  }, body);

  const audioParts = [];
  const timestampParts = [];
  let ended = false;
  for await (const chunk of parseJsonChunks(stream)) {
    if (chunk.code === 0) {
      if (chunk.data) audioParts.push(Buffer.from(chunk.data, "base64"));
      // Preserve any timing payload verbatim — schema unverified until a live 1.0-voice call.
      for (const k of ["timestamp", "timestamps", "words", "word_timestamps"]) {
        if (chunk[k] !== undefined) timestampParts.push({ [k]: chunk[k] });
      }
    } else if (chunk.code === 20000000) {
      ended = true;
      break;
    } else {
      throw new Error(`TTS error chunk ${chunk.code}: ${chunk.message ?? JSON.stringify(chunk)}`);
    }
  }
  if (!ended) throw new Error("TTS stream ended without the 20000000 end marker — audio may be truncated");
  if (audioParts.length === 0) throw new Error("TTS stream carried no audio data");
  return { audio: Buffer.concat(audioParts), timestamps: timestampParts };
}

// The stream is JSON objects separated by newlines. Buffers across chunk boundaries;
// tolerates blank lines; fails loudly on anything unparsable (a half-received line at
// stream end means truncation, which must not pass silently).
async function* parseJsonChunks(stream) {
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const piece of stream) {
    buffer += decoder.decode(piece, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield parseLine(line);
    }
  }
  const tail = (buffer + decoder.decode()).trim();
  if (tail) yield parseLine(tail);
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`Unparsable TTS stream line: ${line.slice(0, 200)}`);
  }
}

// Wrap raw PCM (16-bit signed little-endian, mono — the endpoint's pcm output) in a RIFF
// header so the artifact is a directly playable .wav.
export function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2; // mono * 16-bit
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
