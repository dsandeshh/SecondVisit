// Voice audition (A7a): render one line in several Kokoro voices. Usage: node scripts/voice.mjs [text]
// Model: onnx-community/Kokoro-82M-v1.0-ONNX, cpu, q8. Downloaded into the Hugging Face cache (outside git).
import { KokoroTTS } from "kokoro-js";
import { mkdirSync } from "node:fs";

// Single render (used by the engine's POST /api/tts): node scripts/voice.mjs --render <text> <voice> <out.wav>
const RENDER = process.argv[2] === "--render";
const TEXT = RENDER ? process.argv[3] : process.argv[2] ?? "Reception desk, 2 o'clock, 14 steps.";
const VOICES = (process.env.VOICES ?? "am_michael").split(",");
const OUT = new URL("../public/voice_audition/", import.meta.url).pathname;

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
if (RENDER) {
  const [voice, out] = [process.argv[4], process.argv[5]];
  mkdirSync(new URL(".", `file://${out}`).pathname, { recursive: true });
  await (await tts.generate(TEXT, { voice })).save(out);
  process.kill(process.pid, "SIGKILL"); // onnxruntime aborts in its atexit handler; the file is already saved
}
console.log("available:", Object.keys(tts.voices).join(" "));
mkdirSync(OUT, { recursive: true });
for (const v of VOICES) {
  const audio = await tts.generate(TEXT, { voice: v });
  audio.save(`${OUT}${v}.wav`);
  console.log("wrote", `${OUT}${v}.wav`);
}
