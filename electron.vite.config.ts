import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          engine: resolve(__dirname, 'src/main/engine.ts'),
          mcp: resolve(__dirname, 'src/main/mcp.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          hub: resolve(__dirname, 'src/renderer/hub.html'),
          flowbar: resolve(__dirname, 'src/renderer/flowbar.html')
        }
      }
    }
  }
})
