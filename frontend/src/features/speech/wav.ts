/** Wraps 16-bit mono PCM chunks in a WAV container (playable anywhere). */
export function pcmToWav(chunks: ArrayBuffer[], sampleRate = 16000): Blob {
  const dataBytes = chunks.reduce((n, c) => n + c.byteLength, 0)
  const header = new DataView(new ArrayBuffer(44))
  const text = (offset: number, s: string) => [...s].forEach((ch, i) => header.setUint8(offset + i, ch.charCodeAt(0)))
  text(0, "RIFF")
  header.setUint32(4, 36 + dataBytes, true)
  text(8, "WAVE")
  text(12, "fmt ")
  header.setUint32(16, 16, true) // PCM chunk size
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, sampleRate, true)
  header.setUint32(28, sampleRate * 2, true) // byte rate
  header.setUint16(32, 2, true) // block align
  header.setUint16(34, 16, true) // bits per sample
  text(36, "data")
  header.setUint32(40, dataBytes, true)
  return new Blob([header.buffer, ...chunks], { type: "audio/wav" })
}
