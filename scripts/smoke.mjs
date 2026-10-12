// Launches the BUILT app (not the dev build) in self-test mode and fails if anything
// it needs at startup is broken. CI runs this on every platform before a release.
//   node scripts/smoke.mjs
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

function findApp() {
  if (process.platform === 'win32') return path.join(dist, 'win-unpacked', 'Purr.exe')
  if (process.platform === 'darwin') {
    for (const d of fs.readdirSync(dist)) {
      const exe = path.join(dist, d, 'Purr.app', 'Contents', 'MacOS', 'Purr')
      if (d.startsWith('mac') && fs.existsSync(exe)) return exe
    }
  }
  return path.join(dist, 'linux-unpacked', 'purr')
}

const exe = findApp()
if (!fs.existsSync(exe)) {
  console.error(`Built app not found at ${exe}. Run the dist build first.`)
  process.exit(1)
}
const report = path.join(os.tmpdir(), `purr-smoke-${Date.now()}.json`)
// A throwaway profile, so the check never touches anyone's real Purr data.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'purr-smoke-profile-'))
console.log(`Launching ${exe}`)
const child = spawn(exe, [`--user-data-dir=${profile}`], { env: { ...process.env, PURR_SMOKE: report }, stdio: 'inherit' })
const timer = setTimeout(() => {
  console.error('The app did not finish its self-test in 120 s (a crash dialog is the usual cause).')
  child.kill('SIGKILL')
}, 120_000)

child.on('exit', (code) => {
  clearTimeout(timer)
  if (!fs.existsSync(report)) {
    console.error(`No self-test report: the app exited with code ${code} before writing one. It probably crashed at startup.`)
    process.exit(1)
  }
  const r = JSON.parse(fs.readFileSync(report, 'utf8'))
  console.log(`\nPurr ${r.version} on ${r.platform}`)
  for (const [name, c] of Object.entries(r.checks)) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${name}: ${c.detail}`)
  console.log(r.ok ? '\nSelf-test passed.' : '\nSelf-test FAILED.')
  process.exit(r.ok ? 0 : 1)
})
