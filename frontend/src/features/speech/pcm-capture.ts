/**
 * Turns a microphone MediaStream into 16 kHz mono 16-bit PCM chunks of ~100 ms,
 * the format Sarvam's live speech-to-text expects.
 *
 * Runs in an AudioWorklet (off the main thread). The worklet source is inlined
 * as a Blob so no extra file has to be served or cached.
 */
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = new Int16Array(1600); // 100 ms at 16 kHz
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Simple decimation with averaging (good enough for speech).
    while (this.pos < ch.length) {
      const start = Math.floor(this.pos);
      const end = Math.min(ch.length, Math.floor(this.pos + this.ratio));
      let sum = 0, count = 0;
      for (let i = start; i < Math.max(end, start + 1); i++) { sum += ch[i]; count++; }
      const s = Math.max(-1, Math.min(1, sum / count));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(1600);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`

let moduleUrl: string | null = null

export async function startPcmCapture(stream: MediaStream, onChunk: (pcm: ArrayBuffer) => void): Promise<() => void> {
  const ctx = new AudioContext()
  moduleUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }))
  await ctx.audioWorklet.addModule(moduleUrl)
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, "pcm-capture")
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data)
  source.connect(node)
  // Some browsers only run nodes that reach the output, so route through a
  // muted gain: nothing is audible.
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute).connect(ctx.destination)
  return () => {
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    mute.disconnect()
    void ctx.close()
  }
}
