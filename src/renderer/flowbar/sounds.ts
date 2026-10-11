// Tiny synthesized cues, so there are no audio files to ship.

let ctx: AudioContext | null = null

function tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.value = freq
  const t = ctx.currentTime + at
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

export function play(name: string, volume: number): void {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const v = Math.max(0, Math.min(1, volume)) * 0.22
  switch (name) {
    case 'start':
      tone(660, 0, 0.09, v)
      tone(990, 0.07, 0.12, v)
      break
    case 'stop':
      tone(990, 0, 0.08, v * 0.8)
      tone(740, 0.06, 0.12, v * 0.8)
      break
    case 'lock':
      tone(1180, 0, 0.1, v * 0.7)
      break
    case 'cancel':
      tone(520, 0, 0.09, v * 0.6)
      tone(390, 0.07, 0.14, v * 0.6)
      break
    case 'error':
      tone(240, 0, 0.18, v * 0.7, 'triangle')
      tone(200, 0.12, 0.2, v * 0.7, 'triangle')
      break
  }
}
