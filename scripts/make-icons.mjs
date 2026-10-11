// Rasterizes Purr's icons (rounded rectangles only) to PNG with no dependencies.
// Run: node scripts/make-icons.mjs
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources')
fs.mkdirSync(out, { recursive: true })

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// Signed distance to a rounded rectangle (all units 0..1).
function inRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r && px >= x && px <= x + w && py >= y && py <= y + h
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

function bars(fill, accent, scale) {
  const heights = [0.3, 0.64, 0.46, 0.22]
  const w = 0.085 * scale
  const gap = 0.055 * scale
  const total = heights.length * w + (heights.length - 1) * gap
  let x = 0.5 - total / 2
  return heights.map((h, i) => {
    const hh = h * scale
    const shape = { x, y: 0.5 - hh / 2, w, h: hh, r: w / 2, color: hex(i === 3 ? accent : fill) }
    x += w + gap
    return shape
  })
}

function render(size, shapes) {
  const ss = 4
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = (x + (sx + 0.5) / ss) / size
          const py = (y + (sy + 0.5) / ss) / size
          let col = null
          for (const s of shapes) {
            if (inRoundRect(px, py, s.x, s.y, s.w, s.h, s.r)) col = typeof s.color === 'function' ? s.color(px, py) : s.color
          }
          if (col) {
            r += col[0]
            g += col[1]
            b += col[2]
            a += 1
          }
        }
      }
      const n = ss * ss
      const i = (y * size + x) * 4
      buf[i] = a ? Math.round(r / a) : 0
      buf[i + 1] = a ? Math.round(g / a) : 0
      buf[i + 2] = a ? Math.round(b / a) : 0
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return png(size, buf)
}

const top = hex('#262a31')
const bottom = hex('#111316')
const gradient = (_x, y) => top.map((t, k) => Math.round(t + (bottom[k] - t) * Math.min(1, Math.max(0, (y - 0.09) / 0.82))))

const appShapes = [{ x: 0.09, y: 0.09, w: 0.82, h: 0.82, r: 0.2, color: gradient }, ...bars('#eceef0', '#ff5a5f', 0.9)]
const trayShapes = [{ x: 0.04, y: 0.04, w: 0.92, h: 0.92, r: 0.24, color: hex('#16191d') }, ...bars('#eceef0', '#ff5a5f', 1.15)]
const templateShapes = bars('#000000', '#000000', 1.35)

const jobs = [
  ['icon.png', 1024, appShapes],
  ['icon-256.png', 256, appShapes],
  ['tray.png', 32, trayShapes],
  ['tray@2x.png', 64, trayShapes],
  ['trayTemplate.png', 18, templateShapes],
  ['trayTemplate@2x.png', 36, templateShapes]
]
for (const [file, size, shapes] of jobs) {
  fs.writeFileSync(path.join(out, file), render(size, shapes))
  console.log('wrote', file)
}
