// Microphone capture at 16 kHz mono via an AudioWorklet.

const WORKLET = `
class PurrCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(1024)
    this.n = 0
    this.port.onmessage = () => {
      this.port.postMessage({ flush: true, data: this.buf.slice(0, this.n) })
      this.n = 0
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) {
          this.port.postMessage({ data: this.buf.slice(0) })
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('purr-capture', PurrCapture)
`

const PREROLL_CHUNKS = 5 // ~320 ms kept while the mic is warm

export class Recorder {
  level = 0
  recording = false
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private chunks: Float32Array[] = []
  private preroll: Float32Array[] = []
  private deviceId = ''
  private releaseTimer: number | null = null
  private flushResolve: ((d: Float32Array) => void) | null = null

  private async open(deviceId: string): Promise<void> {
    this.close()
    const constraints: MediaTrackConstraints = { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true }
    if (deviceId) constraints.deviceId = { exact: deviceId }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
    } catch (err) {
      if (deviceId) {
        // The chosen mic is gone (unplugged headset): fall back to the default one.
        delete constraints.deviceId
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      } else throw err
    }
    this.deviceId = deviceId
    this.ctx = new AudioContext({ sampleRate: 16000 })
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'purr-capture')
    this.node.port.onmessage = (e: MessageEvent<{ data: Float32Array; flush?: boolean }>) => {
      const { data, flush } = e.data
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / Math.max(1, data.length))
      this.level = this.level * 0.5 + Math.min(1, rms * 9) * 0.5
      if (this.recording || flush) this.chunks.push(data)
      else {
        this.preroll.push(data)
        if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift()
      }
      if (flush && this.flushResolve) {
        const r = this.flushResolve
        this.flushResolve = null
        r(this.concat())
      }
    }
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    src.connect(this.node)
    this.node.connect(mute).connect(this.ctx.destination)
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.close())
  }

  private alive(): boolean {
    return !!this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live') && this.ctx?.state !== 'closed'
  }

  async start(deviceId: string): Promise<void> {
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = null
    const warm = this.alive() && this.deviceId === deviceId
    if (!warm) await this.open(deviceId)
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    this.chunks = warm ? [...this.preroll] : []
    this.preroll = []
    this.recording = true
  }

  private concat(): Float32Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const out = new Float32Array(total)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    this.chunks = []
    return out
  }

  async stop(keepWarm: boolean): Promise<Float32Array> {
    if (!this.recording) return new Float32Array(0)
    this.recording = false
    let data: Float32Array
    if (this.node) {
      data = await new Promise<Float32Array>((resolve) => {
        this.flushResolve = resolve
        this.node!.port.postMessage('flush')
        setTimeout(() => {
          if (this.flushResolve) {
            this.flushResolve = null
            resolve(this.concat())
          }
        }, 400)
      })
    } else data = this.concat()
    this.scheduleRelease(keepWarm)
    return data
  }

  abort(keepWarm: boolean): void {
    this.recording = false
    this.chunks = []
    this.scheduleRelease(keepWarm)
  }

  private scheduleRelease(keepWarm: boolean): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    // Keep the mic open briefly so back-to-back dictations start instantly.
    this.releaseTimer = window.setTimeout(() => this.close(), keepWarm ? 60_000 : 1500)
  }

  close(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.node = null
    this.level = 0
  }
}
