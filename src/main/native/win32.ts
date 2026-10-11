// Win32 calls through koffi (prebuilt FFI, no compiler needed).

import koffi from 'koffi'

let api: {
  GetForegroundWindow: () => unknown
  GetWindowTextW: (h: unknown, buf: Uint16Array, n: number) => number
  GetWindowThreadProcessId: (h: unknown, pid: Uint32Array) => number
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown
  QueryFullProcessImageNameW: (h: unknown, flags: number, buf: Uint16Array, size: Uint32Array) => boolean
  CloseHandle: (h: unknown) => boolean
  GetCurrentProcessId: () => number
} | null = null

function load(): NonNullable<typeof api> {
  if (api) return api
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  api = {
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16_t *lpString, int nMaxCount)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
    QueryFullProcessImageNameW: kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ uint16_t *lpExeName, _Inout_ uint32_t *lpdwSize)'
    ),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)'),
    GetCurrentProcessId: kernel32.func('uint32_t __stdcall GetCurrentProcessId()')
  }
  return api
}

function utf16(buf: Uint16Array, len: number): string {
  return String.fromCharCode(...buf.subarray(0, len))
}

export interface ForegroundInfo {
  exe: string
  path: string
  title: string
  pid: number
}

export function foregroundWindow(): ForegroundInfo | null {
  const w = load()
  const hwnd = w.GetForegroundWindow()
  if (!hwnd) return null
  const titleBuf = new Uint16Array(512)
  const titleLen = w.GetWindowTextW(hwnd, titleBuf, 512)
  const pidBuf = new Uint32Array(1)
  w.GetWindowThreadProcessId(hwnd, pidBuf)
  const pid = pidBuf[0]
  let exePath = ''
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
  const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (h) {
    const nameBuf = new Uint16Array(1024)
    const size = new Uint32Array([1024])
    if (w.QueryFullProcessImageNameW(h, 0, nameBuf, size)) exePath = utf16(nameBuf, size[0])
    w.CloseHandle(h)
  }
  const exe = exePath.split('\\').pop() ?? ''
  return { exe, path: exePath, title: utf16(titleBuf, titleLen), pid }
}
