// Builds the native helper for the current OS into resources/bin/<os>/.
//   Windows: C# compiled with the csc.exe that ships with .NET Framework 4 (always present).
//   macOS:   Swift compiled with swiftc (Xcode Command Line Tools), universal arm64 + x86_64.
// Purr works without the helper (falls back to uiohook), so failures only warn.
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function buildWindows() {
  const fw = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
  const csc = path.join(fw, 'csc.exe')
  if (!fs.existsSync(csc)) throw new Error(`csc.exe not found at ${csc}`)
  const out = path.join(root, 'resources', 'bin', 'win')
  fs.mkdirSync(out, { recursive: true })
  const wpf = path.join(fw, 'WPF')
  execFileSync(
    csc,
    [
      '/nologo',
      '/optimize+',
      '/target:winexe', // no console window; stdio still works through pipes
      '/platform:anycpu',
      `/out:${path.join(out, 'purr-helper.exe')}`,
      `/reference:${path.join(wpf, 'UIAutomationClient.dll')}`,
      `/reference:${path.join(wpf, 'UIAutomationTypes.dll')}`,
      `/reference:${path.join(wpf, 'WindowsBase.dll')}`,
      path.join(root, 'native', 'win', 'PurrHelper.cs')
    ],
    { stdio: 'inherit' }
  )
  console.log('built resources/bin/win/purr-helper.exe')
}

function buildMac() {
  const out = path.join(root, 'resources', 'bin', 'mac')
  fs.mkdirSync(out, { recursive: true })
  const src = path.join(root, 'native', 'mac', 'PurrHelper.swift')
  const arm = path.join(out, 'purr-helper-arm64')
  const x86 = path.join(out, 'purr-helper-x86_64')
  execFileSync('swiftc', ['-O', '-target', 'arm64-apple-macos11', src, '-o', arm], { stdio: 'inherit' })
  execFileSync('swiftc', ['-O', '-target', 'x86_64-apple-macos10.15', src, '-o', x86], { stdio: 'inherit' })
  execFileSync('lipo', ['-create', arm, x86, '-output', path.join(out, 'purr-helper')], { stdio: 'inherit' })
  fs.rmSync(arm)
  fs.rmSync(x86)
  console.log('built resources/bin/mac/purr-helper (universal)')
}

try {
  if (process.platform === 'win32') buildWindows()
  else if (process.platform === 'darwin') buildMac()
  else console.log('No native helper for this platform; Purr will use uiohook.')
} catch (err) {
  console.warn(`[helpers] build failed, Purr will fall back to uiohook: ${err.message}`)
}
