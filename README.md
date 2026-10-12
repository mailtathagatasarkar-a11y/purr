# Purr

Voice dictation that works in every app, on Windows and macOS. Hold a key, talk, let go: Purr types clean text where your cursor is. It drops the ums, follows your corrections ("at 2, actually 3" becomes "at 3"), formats lists, and matches the tone of the app you're in.

It runs **fully on your computer** (private, offline) or **in the cloud** with your own API key. You can also mix the two.

Purr is an independent, clean-room project modeled on Wispr Flow's public feature set. It contains no Wispr code or assets and isn't affiliated with Wispr.

---

## Install

**Windows:** download `Purr-Setup-<version>.exe` from the [latest release](https://github.com/mailtathagatasarkar-a11y/purr/releases/latest) and run it. It's unsigned for now, so SmartScreen may warn you. Click *More info → Run anyway*.

**macOS, easiest:** paste this into Terminal. It downloads the right build for your Mac, puts it in Applications and opens it, without the "Not Opened" warning (Terminal downloads aren't flagged the way browser downloads are). It's a short script; [read it first](install.sh) if you like.

```bash
curl -fsSL https://raw.githubusercontent.com/mailtathagatasarkar-a11y/purr/main/install.sh | bash
```

**macOS, manual:** download the `arm64.dmg` (Apple Silicon) or `x64.dmg` (Intel) from the [latest release](https://github.com/mailtathagatasarkar-a11y/purr/releases/latest) and drag Purr to Applications. It isn't notarized yet, so the first launch says *"Purr" Not Opened*. Click **Done**, open **System Settings → Privacy & Security**, click **Open Anyway** next to *"Purr" was blocked*, enter your password, then open Purr again. Grant **Microphone** and **Accessibility** when asked.

On first launch Purr asks where it should do the work:

| | On this computer | In the cloud |
|---|---|---|
| Privacy | Audio never leaves your machine | Audio goes to the provider you pick |
| Setup | One-time download: Parakeet v3 (0.7 GB) + Qwen3 4B (2.5 GB, optional) | Paste one API key (Groq has a free tier) |
| Speed on this PC | ~1–1.5 s per dictation (RTX 5050) | ~0.5–1 s |

## Shortcuts

| Action | Windows | Mac (Apple keyboard) | Mac (other keyboards) |
|---|---|---|---|
| Push to talk (hold) | `Ctrl + Win` | `fn` | `Ctrl + Option` |
| Hands-free (press to start / stop) | `Ctrl + Win + Space` or double-tap | `fn + Space` or double-tap | `Ctrl + Option + Space` |
| Command Mode (hold) | `Ctrl + Win + Alt` | `fn + Ctrl` | `Ctrl + Option + Cmd` |
| Cancel | `Esc` | `Esc` | `Esc` |
| Paste last transcript | `Alt + Shift + Z` | `Ctrl + Cmd + V` | `Ctrl + Cmd + V` |
| Scratchpad | `Win + Alt + S` | `Option + S` | `Option + S` |
| Polish selected text | `Win + Alt + 1` | `Option + 1` | `Option + 1` |
| Prompt Engineer | `Win + Alt + 2` | `Option + 2` | `Option + 2` |
| View last transform's changes | `Win + Alt + O` | `Option + O` | `Option + O` |

All shortcuts can be changed in **Settings → General**, including single keys like Right Ctrl or a mouse side button. A quick tap is ignored, a third quick tap cancels, and pressing an unrelated key in the first second (e.g. `Ctrl + Win + D`) cancels too, so system shortcuts still work.

On a Mac using `fn`: in System Settings → Keyboard, set **Press 🌐 key to** → **Do Nothing**.

## How Purr handles fumbles

Two layers run on every dictation:

1. **Rules (instant, offline, always on):** removes `um/uh/er`, stutters (`I I think`, `the the`, `w- want`), "new line / new paragraph", and, when AI is off, "scratch that" and spoken punctuation ("comma", "question mark"). The filler rules are skipped for languages where "um" or "er" are real words, like German.
2. **AI clean-up (local Qwen3 4B, or any cloud model):** backtracking ("send it to John, no wait, Sarah" becomes "send it to Sarah"), lists, numbers ("twenty five thousand dollars" becomes "$25,000"), grammar, email layout and tone. The transcript is always treated as text to clean, never as instructions, so "what's the capital of France" is typed, not answered. Output that looks like an answer or chatter is rejected and the rules version is used instead.

If the AI is unavailable or still loading, Purr inserts the rules version immediately rather than making you wait.

## Feature checklist vs. Wispr Flow

✅ = done · 🟡 = partly / different approach · ❌ = not included

| Wispr Flow feature | Purr |
|---|---|
| Push-to-talk, hands-free, double-tap lock, triple-tap cancel, short-tap tip, Esc cancel | ✅ |
| Flow Bar: rest / listening / processing, click to dictate, stop + cancel buttons, follows your active display, right-click "Hide for 1 hour", "Show at all times" | ✅ |
| Types into any app (clipboard paste, then your clipboard is restored; Shift+Insert in Windows IDEs/terminals) | ✅ |
| Paste last transcript | ✅ |
| Auto Clean-up levels None / Light / Medium (+ Polished) | ✅ |
| Backtrack and smart formatting (punctuation, lists, numbers, spoken commands) | ✅ |
| Styles per app category (Personal / Work / Email / Other × Formal / Casual / Very casual / Excited) incl. trailing-period rules | ✅ |
| Email formatting (greeting, paragraphs, sign-off) | ✅ |
| Dictionary: words, misspelling corrections, learned words | ✅ Learns from fixes in History. On Windows it also checks the field after you fix a word (via the helper). |
| Snippets: matching rules, longest trigger wins, exact expansion when spoken alone | ✅ Plain text only, no rich-text formatting |
| Command Mode: edit selection, draft at cursor, web search (Perplexity / Google / ChatGPT), answers in a card | ✅ |
| Transforms: Polish (5 rules + your rules + writing samples), Prompt Engineer, up to 8 custom, View Diff, re-transforms, auto-apply after dictation | ✅ |
| Scratchpad notes: shortcut, dictate, pin, search, version history | 🟡 No tabs or images; plain text |
| 100+ languages, auto-detect, pick several, Hinglish | ✅ Cloud: all. Local: Whisper Turbo covers 99; Parakeet covers 25 European. |
| Whispering / quiet speech | ✅ Gain boost |
| History: copy, Undo AI edit, transcribe again from saved audio (14-day retention), search | ✅ |
| Usage insights: WPM, words, fixes, streaks, heatmap, apps, categories, time saved | ✅ |
| Upload an audio file to transcribe | ✅ |
| Vibe coding: variable names, @-file tagging in Cursor / Windsurf | 🟡 AI-formatted identifiers and spoken "at file dot ts". Wispr also reads the open file through screen-reader mode; Purr doesn't. |
| Context awareness | 🟡 App + window title (web apps detected by title). Wispr also reads on-screen names. |
| Sync across devices | 🟡 Through a folder iCloud / OneDrive / Dropbox already syncs (no account needed) |
| Team dictionary & snippets | 🟡 Share that synced folder. No admin console, SSO or SCIM. |
| MCP server for Claude / ChatGPT | ✅ Local, read-only (Settings → Data & privacy → Copy config) |
| Privacy mode, data export/import | ✅ |
| Fully local mode | ✅ Wispr doesn't offer this |
| iOS / Android apps, Wispr Notetaker (meetings), accounts & billing, auto-update, signed installers | ❌ |

## Build from source

Requires Node 24+. No C++ toolchain needed: every native piece is prebuilt.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run dist:win
```

On a Mac (needs Xcode Command Line Tools for the Swift helper):

```bash
npm run dist:mac
```

Or push a tag like `v0.1.0` (or run the workflow manually) and GitHub Actions builds both installers: `.github/workflows/build.yml`.

### Testing

- `npm test` runs unit tests for the clean-up rules and the shortcut gestures.
- `tests/e2e/run.cjs` drives the real app on Windows: real keyboard hook, speech-to-text, AI clean-up and paste into a throwaway window. Only the microphone is replaced by a WAV file (`PURR_FAKE_MIC`, dev builds only). See the comment at the top of the file.
- `PURR_SNAP=<folder>` (dev builds only) saves screenshots of the windows for UI review.

## How it's built

| Piece | What it uses |
|---|---|
| App shell | Electron 44, React 19, TypeScript, electron-vite |
| Global shortcuts | `uiohook-napi`, plus a native helper that can swallow shortcut keys: C# on Windows (built with the `csc.exe` every Windows has), Swift on macOS (adds the fn key) |
| Local speech-to-text | `sherpa-onnx-node` running NVIDIA Parakeet TDT v3, Whisper, Moonshine or SenseVoice in a background process |
| Local AI | `node-llama-cpp` (llama.cpp) with Qwen3 4B Instruct, on Vulkan / Metal / CPU |
| Cloud | Groq, OpenAI, Deepgram, ElevenLabs (speech); Anthropic (official SDK), OpenAI, Gemini, Groq, OpenRouter, Ollama, LM Studio, any OpenAI-compatible server (AI) |
| Active app | Win32 calls via `koffi` on Windows; the helper / AppleScript on macOS |
| Storage | JSON files in your user-data folder. API keys are encrypted with the OS keychain / DPAPI. |

Key files: `src/main/controller.ts` (the dictation flow), `src/main/gestures.ts` (shortcut timing), `src/shared/text.ts` (rules), `src/shared/prompts.ts` (AI instructions), `src/renderer/flowbar/` (Flow Bar + recorder), `src/renderer/hub/` (the app window).

## License

Purr is MIT licensed (see [LICENSE](LICENSE)). It bundles libuiohook (LGPL-3.0) as a separate, replaceable native module, and downloads speech and language models under their own licenses. Details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contributing

Issues and pull requests are welcome. Run `npm test` and `npm run typecheck` before opening a PR. The macOS helper (`native/mac/PurrHelper.swift`) hasn't been tested on real hardware yet, so Mac reports are especially useful.
