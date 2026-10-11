// Small audio helpers for 16 kHz mono Float32 PCM.

export const SAMPLE_RATE = 16000

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / Math.max(1, end - start))
}

/** Per-frame RMS energy (default 30 ms frames). */
export function frameEnergies(samples: Float32Array, frameMs = 30, rate = SAMPLE_RATE): Float32Array {
  const size = Math.round((rate * frameMs) / 1000)
  const n = Math.floor(samples.length / size)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) out[f] = rms(samples, f * size, (f + 1) * size)
  return out
}

/** Adaptive speech check: needs enough frames clearly above the noise floor. */
export function speechStats(samples: Float32Array, rate = SAMPLE_RATE): { hasSpeech: boolean; speechMs: number; peak: number } {
  const e = frameEnergies(samples, 30, rate)
  if (e.length === 0) return { hasSpeech: false, speechMs: 0, peak: 0 }
  const sorted = Array.from(e).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0
  const threshold = Math.max(0.006, floor * 3)
  let voiced = 0
  let peak = 0
  for (const v of e) {
    if (v > threshold) voiced++
    if (v > peak) peak = v
  }
  const speechMs = voiced * 30
  return { hasSpeech: speechMs >= 180 && peak > 0.01, speechMs, peak }
}

/** Trim leading/trailing silence, keeping a little padding so words aren't clipped. */
export function trimSilence(samples: Float32Array, rate = SAMPLE_RATE, padMs = 250): Float32Array {
  const frame = Math.round(rate * 0.03)
  const e = frameEnergies(samples, 30, rate)
  if (e.length === 0) return samples
  const sorted = Array.from(e).sort((a, b) => a - b)
  const threshold = Math.max(0.006, (sorted[Math.floor(sorted.length * 0.1)] ?? 0) * 3)
  let first = e.findIndex((v) => v > threshold)
  let last = e.length - 1
  while (last >= 0 && e[last] <= threshold) last--
  if (first < 0 || last < first) return samples
  const pad = Math.round((rate * padMs) / 1000)
  first = Math.max(0, first * frame - pad)
  const end = Math.min(samples.length, (last + 1) * frame + pad)
  return samples.subarray(first, end)
}

/** "Whisper mode": lift quiet speech so the recognizer hears it. Caps gain at 12x. */
export function normalizeGain(samples: Float32Array, target = 0.5, maxGain = 12): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  if (peak <= 0 || peak >= target) return samples
  const gain = Math.min(maxGain, target / peak)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain
  return out
}

/**
 * Split long audio into chunks of at most `maxSec`, cutting at the quietest
 * 100 ms window in the last third of each chunk so we don't cut words.
 */
export function splitForStt(samples: Float32Array, maxSec: number, rate = SAMPLE_RATE): Float32Array[] {
  const max = Math.floor(maxSec * rate)
  if (samples.length <= max) return [samples]
  const chunks: Float32Array[] = []
  const win = Math.round(rate * 0.1)
  let start = 0
  while (samples.length - start > max) {
    const searchFrom = start + Math.floor(max * 0.66)
    const searchTo = start + max - win
    let best = searchTo
    let bestE = Infinity
    for (let s = searchFrom; s < searchTo; s += Math.round(win / 2)) {
      const v = rms(samples, s, s + win)
      if (v < bestE) {
        bestE = v
        best = s + Math.round(win / 2)
      }
    }
    chunks.push(samples.subarray(start, best))
    start = best
  }
  chunks.push(samples.subarray(start))
  return chunks
}

/** A small loudness outline of the recording ("voiceprint"), values 0..1. */
export function envelope(samples: Float32Array, buckets = 40): number[] {
  if (!samples.length) return []
  const size = Math.max(1, Math.floor(samples.length / buckets))
  const raw: number[] = []
  for (let b = 0; b < buckets; b++) raw.push(rms(samples, b * size, Math.min(samples.length, (b + 1) * size)))
  const peak = Math.max(...raw, 1e-6)
  return raw.map((v) => Math.round(Math.sqrt(v / peak) * 100) / 100)
}

/** 16-bit PCM WAV bytes. */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** Read a 16-bit PCM mono WAV (finds the "data" chunk, so extra header chunks are fine). */
export function decodeWav(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let start = 44
  let length = bytes.byteLength - 44
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    const size = view.getUint32(offset + 4, true)
    if (id === 'data') {
      start = offset + 8
      length = Math.min(size, bytes.byteLength - start)
      break
    }
    offset += 8 + size + (size % 2)
  }
  const n = Math.floor(length / 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = view.getInt16(start + i * 2, true) / 0x8000
  return out
}
