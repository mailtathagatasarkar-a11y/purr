export {}

declare global {
  interface Window {
    purr: {
      platform: string
      invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
      send(channel: string, ...args: unknown[]): void
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on(channel: string, cb: (...args: any[]) => void): () => void
    }
  }
}
