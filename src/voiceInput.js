// 语音输入：录音 → 转 16kHz 单声道 WAV → base64 data URI。
// qwen3-asr-flash 只吃 wav/mpeg，而浏览器 MediaRecorder 录的是 webm/opus，
// 所以录完用 AudioContext 解码成 PCM，再用 OfflineAudioContext 重采样到 16kHz 单声道，编码成 WAV。

/** 当前环境是否支持语音录制（微信 WebView、老浏览器可能不支持） */
export function isVoiceSupported() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    !!window.MediaRecorder &&
    !!(window.AudioContext || window.webkitAudioContext)
  );
}

/** Float32 PCM（-1..1）编码为 16-bit PCM 的 WAV 字节 */
function encodeWav(float32, sampleRate) {
  const n = float32.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, n * 2, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

/** ArrayBuffer → base64（分块，避免大缓冲爆栈） */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 把录音 Blob 解码并重采样为 16kHz 单声道，返回 WAV 的 data URI */
async function blobToWavDataUri(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const arrayBuf = await blob.arrayBuffer();

  const decodeCtx = new AudioCtx();
  const decoded = await decodeCtx.decodeAudioData(arrayBuf);
  decodeCtx.close?.();

  const targetRate = 16000;
  const frames = Math.ceil(decoded.duration * targetRate);
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  const wav = encodeWav(rendered.getChannelData(0), targetRate);
  return "data:audio/wav;base64," + arrayBufferToBase64(wav);
}

/** 选一个浏览器支持的录音 MIME */
function pickMime() {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of cands) {
    if (window.MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

/**
 * 录音控制器。start() 开始，stop() 结束并返回 WAV data URI，cancel() 丢弃。
 */
export class VoiceRecorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.start();
  }

  /** 停止并返回 WAV data URI；无有效音频返回 null */
  async stop() {
    if (!this.recorder) return null;
    const stopped = new Promise((resolve) => { this.recorder.onstop = resolve; });
    this.recorder.stop();
    await stopped;
    this._release();
    if (!this.chunks.length) return null;
    const blob = new Blob(this.chunks, { type: this.chunks[0].type || "audio/webm" });
    this.chunks = [];
    return blobToWavDataUri(blob);
  }

  cancel() {
    try { this.recorder?.stop(); } catch { /* ignore */ }
    this._release();
    this.chunks = [];
  }

  _release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }
}
