# chat-demo

English | [简体中文](README.zh-CN.md)

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Model services

The model picker at the bottom-left of the composer lists models grouped by service and switches both at once; Settings → Data remains the place to add and edit services. DeepSeek is built in; every other service is added by you, and several can coexist — each with its own name, endpoint, API key and model.

| Service            | Protocol           | Web search | Attachments | Speech |
| ------------------ | ------------------ | ---------- | ----------- | ------ |
| DeepSeek (built in)| Anthropic Messages | Yes        | Yes         | Yes    |
| Added services     | Chat Completions   | No         | No          | No     |

"Add service" first asks for a preset (OpenAI, Command Code, SiliconFlow, local Ollama), which fills in the name, endpoint and fallback models; choose "Custom" to type your own. Endpoints must be OpenAI-compatible and include the version segment — do not paste a provider's Anthropic endpoint:

| Target          | Endpoint                                 |
| --------------- | ---------------------------------------- |
| OpenAI          | `https://api.openai.com/v1`              |
| Command Code    | `https://api.commandcode.ai/provider/v1` |
| Local Ollama    | `http://localhost:11434/v1`              |
| SiliconFlow     | `https://api.siliconflow.cn/v1`          |

About 0.7s after you stop typing the endpoint, the model list is fetched from `{endpoint}/models` and cached per service in localStorage. Some services have no such route — their gateway answers 401 for any path before routing — so presets ship fallback models and the failure notice is suppressed for them; services without fallback models still report the reason (bad endpoint or key 401/403, missing route 404, response is not a model list, unreachable). Responses for an outdated endpoint are discarded, and a model that disappears from the new list falls back to that service's default. Catalogs carrying `supported_endpoints` are filtered to models that support `/chat/completions`. "Models shown" narrows a long catalog to the few you actually use (search, select all, clear); the picker lists only the checked models and always keeps the one in use. Selecting everything means no restriction, so newly published models appear automatically. "Models shown" narrows a long catalog to the few you actually use (search, select all, clear); the picker lists only the checked models and always keeps the one in use. Selecting everything means no restriction, so newly published models appear automatically. Model IDs outside the list can be entered via "Custom model". Removing a service also clears its key, model and cached list, and switches back to DeepSeek.

The DeepSeek channel speaks Anthropic Messages. Request bodies are trimmed by capability flags: unsupported extensions (`system`, `tools`, `safety_check`, `title`, `latest_reminder`, `max_tokens`) are omitted so strict endpoints do not reject them with 400. Its compatible endpoint has no matching models API (the platform `/models` is an OpenAI-style catalog, a different set from `/anthropic/v1`), so it keeps the built-in list.

Added services speak OpenAI Chat Completions and have no web search, citations, attachments, server-side titles or reasoning toggle, because Chat Completions has no equivalent structures. [openai.ts](src/services/api/openai.ts) converts the request body, adds `stream`, and translates deltas back into internal block events, so conversations, continuation and import/export stay protocol-agnostic.

Speech (ASR / TTS) and attachments (Files API) are DeepSeek-only and always use the DeepSeek key regardless of the selected service; their entry points hide when no DeepSeek key is configured.

To add a built-in service, add one `ProviderProfile` in [providers.ts](src/services/api/providers.ts).

## Data and storage

API keys for each model service and other settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder` only when the selected service supports them; endpoints and capability flags live in [src/services/api/providers.ts](src/services/api/providers.ts). Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
