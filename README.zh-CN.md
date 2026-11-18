# chat-demo

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 模型服务

输入框左下角有模型选择按钮，按服务分组列出模型，选中即切换服务与模型；也可以到设置 → 数据管理 里管理。内置 DeepSeek；其余服务由用户自己添加，可以同时存在多条，每条都有自己的名称、地址、API Key 与模型。

| 服务               | 协议               | 联网搜索 | 附件上传 | 语音 |
| ------------------ | ------------------ | -------- | -------- | ---- |
| DeepSeek（内置）   | Anthropic Messages | 支持     | 支持     | 支持 |
| 添加的服务         | Chat Completions   | 不支持   | 不支持   | 不支持 |

点「添加服务」先选预设（OpenAI、Command Code、SiliconFlow、本地 Ollama），名称、地址与兜底模型会自动填好；也可以选「自定义」手填。地址一律按 OpenAI 兼容格式、带版本段，注意别填成各家的 Anthropic 面：

| 目标         | 接口地址                                 |
| ------------ | ---------------------------------------- |
| OpenAI       | `https://api.openai.com/v1`              |
| Command Code | `https://api.commandcode.ai/provider/v1` |
| 本地 Ollama  | `http://localhost:11434/v1`              |
| SiliconFlow  | `https://api.siliconflow.cn/v1`          |

地址输入停顿约 0.7 秒后会自动从 `{地址}/models` 拉取模型列表，并按服务缓存在 localStorage；有些服务没有该接口（任何路径都先返回 401），这类情况直接使用预设自带的兜底模型、不提示失败；没有兜底模型的服务仍会提示原因——地址或 Key 不正确（401/403）、接口不存在（404）、返回内容不是模型列表、无法连接。换地址时旧地址的响应会被丢弃，当前模型不在新列表里时回落到该服务的默认模型。目录里带 `supported_endpoints` 时只保留支持 `/chat/completions` 的模型。列表之外的模型 id 可以选「自定义模型」手填。删除服务会连带清掉它的 Key、模型与列表缓存，当前选中项回到 DeepSeek。

DeepSeek 通道走 Anthropic Messages 协议，请求体按能力位裁剪：不支持的扩展（system 身份说明、`tools`、`safety_check`、`title`、`latest_reminder`、`max_tokens`）不发送，避免严格校验的端点直接返回 400。它的兼容端点没有对应的 models 接口（平台的 `/models` 是 OpenAI 风格目录，与 `/anthropic/v1` 的模型集不同），因此固定使用内置列表。

添加的服务走 OpenAI Chat Completions，没有联网搜索、来源引用、附件上传、服务端自动命名与推理开关——Chat Completions 没有对应结构；请求体在 [openai.ts](src/services/api/openai.ts) 里转换并补 `stream`，流式增量再翻译回内部块事件，因此会话、续写与导入导出都不区分协议。

语音（ASR / TTS）与附件上传（Files API）只有 DeepSeek 提供，固定使用 DeepSeek 的 Key，与当前对话服务无关；未配置 DeepSeek Key 时相应入口不展示。

新增内置供应商只需在 [providers.ts](src/services/api/providers.ts) 里加一条 `ProviderProfile`。

## 数据

各服务的 API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。DeepSeek 的请求会带上搜索、链接阅读、标题和 `latest_reminder` 等扩展，添加的服务走 Chat Completions，只发送该协议支持的字段。供应商配置集中在 [src/services/api/providers.ts](src/services/api/providers.ts)。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
