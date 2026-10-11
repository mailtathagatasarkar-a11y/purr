# Third-party notices

Purr's own code is MIT licensed (see `LICENSE`). It ships with, or downloads, the following third-party software and models under their own licenses.

## Bundled in the app

| Component | License | Notes |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | App runtime |
| [uiohook-napi](https://github.com/SnosMe/uiohook-napi) | MIT | Node binding for global keyboard and mouse hooks |
| [libuiohook](https://github.com/kwhat/libuiohook) | LGPL-3.0-or-later | Compiled into uiohook-napi's native module, which ships as a separate, replaceable file (`app.asar.unpacked/node_modules/uiohook-napi/prebuilds/…`). You may replace it with your own build of libuiohook. Source: https://github.com/kwhat/libuiohook |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (`sherpa-onnx-node`) | Apache-2.0 | Local speech-to-text runtime, includes ONNX Runtime (MIT) |
| [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) and [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | Local language model runtime |
| [koffi](https://github.com/Koromix/koffi) | MIT | Windows API calls |
| [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) | MIT | Claude API client |
| [React](https://github.com/facebook/react) | MIT | UI |
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | SIL Open Font License 1.1 | UI fonts |

## Downloaded on demand (not included in the installer)

Purr downloads these models from Hugging Face only when you choose them in Settings → Engine.

| Model | License |
|---|---|
| NVIDIA Parakeet TDT 0.6B v3 (sherpa-onnx int8 export) | CC-BY-4.0 |
| OpenAI Whisper (turbo, small) | MIT |
| Moonshine base | MIT |
| SenseVoice small | See the model card (FunASR model license) |
| Qwen3 4B Instruct 2507 | Apache-2.0 |
| Llama 3.2 3B Instruct | Llama 3.2 Community License |
| Qwen2.5 1.5B Instruct | Apache-2.0 |

Check each model card for the current terms before redistributing a model yourself.

## Trademarks

Purr is an independent project. It is not affiliated with, endorsed by, or sponsored by Wispr AI or any other company named in this repository. Product names are used only to describe compatibility and inspiration.
