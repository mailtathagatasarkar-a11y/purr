// Local AI engine. Runs in an Electron utility process so heavy speech-to-text
// and LLM work never freezes hotkeys or the UI.

import os from 'os'
import { splitForStt } from '../shared/audio'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = { id: number; type: string; [k: string]: any }

const port = (process as unknown as { parentPort: { on: (e: 'message', cb: (m: { data: Msg }) => void) => void; postMessage: (m: unknown) => void } }).parentPort

const threads = Math.max(2, Math.min(8, os.cpus().length - 2))

// ---------- speech-to-text (sherpa-onnx) ----------
let sherpa: any = null
const recognizers = new Map<string, any>()

function recognizerFor(modelType: string, paths: Record<string, string>, language: string): any {
  const key = `${modelType}:${paths.encoder ?? paths.model}:${modelType === 'whisper' ? language : ''}`
  const cached = recognizers.get(key)
  if (cached) return cached
  sherpa ??= require('sherpa-onnx-node')
  // Keep at most one recognizer in memory.
  recognizers.clear()
  const modelConfig: Record<string, unknown> = { tokens: paths.tokens, numThreads: threads, provider: 'cpu', debug: 0 }
  if (modelType === 'parakeet') {
    modelConfig.transducer = { encoder: paths.encoder, decoder: paths.decoder, joiner: paths.joiner }
    modelConfig.modelType = 'nemo_transducer'
  } else if (modelType === 'whisper') {
    modelConfig.whisper = { encoder: paths.encoder, decoder: paths.decoder, language, task: 'transcribe' }
  } else if (modelType === 'moonshine') {
    modelConfig.moonshine = {
      preprocessor: paths.preprocessor,
      encoder: paths.encoder,
      uncachedDecoder: paths.uncachedDecoder,
      cachedDecoder: paths.cachedDecoder
    }
  } else if (modelType === 'sensevoice') {
    modelConfig.senseVoice = { model: paths.model, language: '', useInverseTextNormalization: 1 }
  }
  const rec = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig })
  recognizers.set(key, rec)
  return rec
}

function transcribe(msg: Msg): { text: string; language?: string } {
  const samples: Float32Array = msg.samples
  const rec = recognizerFor(msg.modelType, msg.paths, msg.language ?? '')
  const parts: string[] = []
  let language: string | undefined
  for (const chunk of splitForStt(samples, 28)) {
    const stream = rec.createStream()
    stream.acceptWaveform({ sampleRate: 16000, samples: chunk })
    rec.decode(stream)
    const r = rec.getResult(stream)
    if (r?.text) parts.push(String(r.text).trim())
    if (r?.lang) language = String(r.lang).replace(/[<>|]/g, '')
  }
  let text = parts.join(' ').replace(/\s+/g, ' ').trim()
  // SenseVoice tags like <|en|><|NEUTRAL|>
  text = text.replace(/<\|[^|]*\|>/g, '').trim()
  return { text, language }
}

// ---------- LLM (node-llama-cpp) ----------
let llama: any = null
let model: { path: string; model: any; context: any } | null = null

async function loadLlm(modelPath: string): Promise<NonNullable<typeof model>> {
  if (model?.path === modelPath) return model
  const nlc = await import('node-llama-cpp')
  llama ??= await nlc.getLlama({ gpu: 'auto' })
  if (model) {
    await model.context.dispose()
    await model.model.dispose()
    model = null
  }
  const m = await llama.loadModel({ modelPath })
  const context = await m.createContext({ contextSize: { max: 8192 } })
  model = { path: modelPath, model: m, context }
  return model
}

async function complete(msg: Msg): Promise<{ text: string }> {
  const nlc = await import('node-llama-cpp')
  const loaded = await loadLlm(msg.modelPath)
  const sequence = loaded.context.getSequence()
  try {
    const session = new nlc.LlamaChatSession({ contextSequence: sequence, systemPrompt: msg.system })
    const text: string = await session.prompt(msg.user, {
      maxTokens: msg.maxTokens ?? 1024,
      temperature: 0.2,
      ...(msg.json ? { grammar: await llama.getGrammarFor('json') } : {})
    })
    session.dispose({ disposeSequence: false })
    return { text }
  } finally {
    sequence.dispose()
  }
}

// ---------- message loop (one job at a time per kind) ----------
const queues: Record<string, Promise<unknown>> = { stt: Promise.resolve(), llm: Promise.resolve() }

port.on('message', ({ data: msg }) => {
  const kind = msg.type.startsWith('llm') ? 'llm' : 'stt'
  queues[kind] = queues[kind].then(async () => {
    try {
      let result: unknown
      if (msg.type === 'stt.transcribe') result = transcribe(msg)
      else if (msg.type === 'stt.warm') result = (recognizerFor(msg.modelType, msg.paths, msg.language ?? ''), { ok: true })
      else if (msg.type === 'llm.complete') result = await complete(msg)
      else if (msg.type === 'llm.warm') result = (await loadLlm(msg.modelPath), { ok: true, gpu: llama?.gpu ?? false })
      else if (msg.type === 'selftest') {
        // Load both native engines without a model: proves their binaries shipped for this OS and CPU.
        sherpa ??= require('sherpa-onnx-node')
        const nlc = await import('node-llama-cpp')
        const cpu = await nlc.getLlama({ gpu: false })
        result = { sherpa: String(sherpa.version ?? 'loaded'), llama: cpu ? 'loaded' : 'missing', platform: `${process.platform}-${process.arch}` }
      }
      else if (msg.type === 'unload') {
        recognizers.clear()
        if (model) {
          await model.context.dispose()
          await model.model.dispose()
          model = null
        }
        result = { ok: true }
      } else throw new Error(`Unknown job ${msg.type}`)
      port.postMessage({ id: msg.id, ok: true, result })
    } catch (err) {
      port.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
})
