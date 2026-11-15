// Voice audition (A7a): render one line in several Kokoro voices. Usage: node scripts/voice.mjs [text]
// Model: onnx-community/Kokoro-82M-v1.0-ONNX, cpu, q8. Downloaded into the Hugging Face cache (outside git).
import { KokoroTTS } from "kokoro-js";
import { mkdirSync } from "node:fs";

const TEXT = process.argv[2] ?? "Reception desk, 2 o'clock, 14 steps.";
const VOICES = (process.env.VOICES ?? "af_heart,af_bella,am_michael,bf_emma,bm_george").split(",");
const OUT = new URL("../public/voice_audition/", import.meta.url).pathname;

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
console.log("available:", Object.keys(tts.voices).join(" "));
mkdirSync(OUT, { recursive: true });
for (const v of VOICES) {
  const audio = await tts.generate(TEXT, { voice: v });
  audio.save(`${OUT}${v}.wav`);
  console.log("wrote", `${OUT}${v}.wav`);
}
