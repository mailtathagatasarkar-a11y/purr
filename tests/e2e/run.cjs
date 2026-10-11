// End-to-end test on Windows: real hotkey hook, real speech-to-text, real AI clean-up,
// real paste into a real window. Only the microphone is replaced by a WAV file.
//
// 1. Build Purr (npx electron-vite build) and start it with
//      PURR_FAKE_MIC=<scratch>/mic.wav
// 2. node tests/e2e/run.cjs <scratch dir> <case>
//    cases: dictate <wav> | command <wav> <selectedText> | polish <selectedText>
const { execFileSync, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { uIOhook, UiohookKey: K } = require('uiohook-napi')

const [, , scratch, kind, a, b] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pad = path.join(scratch, 'TestPad.exe')
if (!fs.existsSync(pad)) {
  const csc = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  execFileSync(csc, ['/nologo', '/target:winexe', `/out:${pad}`, path.join(__dirname, 'TestPad.cs')])
}

async function hold(keys, ms) {
  for (const k of keys) {
    uIOhook.keyToggle(k, 'down')
    await sleep(40)
  }
  await sleep(ms)
  for (const k of [...keys].reverse()) {
    uIOhook.keyToggle(k, 'up')
    await sleep(40)
  }
}

;(async () => {
  const out = path.join(scratch, `result-${kind}.txt`)
  fs.rmSync(out, { force: true })
  if (a && fs.existsSync(a) && a.endsWith('.wav')) fs.copyFileSync(a, path.join(scratch, 'mic.wav'))
  const initial = kind === 'command' ? b : kind === 'polish' ? a : ''
  const proc = spawn(pad, [out, '22', initial], { stdio: 'ignore' })
  await sleep(1500)
  const t0 = Date.now()
  if (kind === 'dictate') await hold([K.Ctrl, K.Meta], 1200)
  else if (kind === 'command') await hold([K.Ctrl, K.Meta, K.Alt], 1200)
  else if (kind === 'polish') await hold([K.Meta, K.Alt, K[1]], 150)
  else if (kind === 'handsfree') {
    await hold([K.Ctrl, K.Meta, K.Space], 120)
    await sleep(2000)
    await hold([K.Ctrl, K.Meta, K.Space], 120)
  } else if (kind === 'doubletap') {
    await hold([K.Ctrl, K.Meta], 90)
    await sleep(120)
    await hold([K.Ctrl, K.Meta], 90)
    await sleep(2000)
    await hold([K.Ctrl, K.Meta], 90)
  } else if (kind === 'cancel') {
    uIOhook.keyToggle(K.Ctrl, 'down')
    uIOhook.keyToggle(K.Meta, 'down')
    await sleep(1500)
    uIOhook.keyTap(K.Escape)
    await sleep(100)
    uIOhook.keyToggle(K.Meta, 'up')
    uIOhook.keyToggle(K.Ctrl, 'up')
  } else if (kind === 'pastelast') await hold([K.Alt, K.Shift, K.Z], 120)
  await new Promise((r) => proc.on('exit', r))
  const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '(no output)'
  console.log(JSON.stringify({ case: kind, typed: text, keysAtMs: t0 }))
  process.exit(0)
})()
