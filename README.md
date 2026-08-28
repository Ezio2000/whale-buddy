# Whale Buddy

Whale Buddy 是一个面向 macOS 与 Windows 的 Codex 桌面客户端。它以 Electron、React 和
TypeScript 构建，通过 stdio JSONL 连接仓库中固定版本的 `codex app-server`，并把
Codex 的对话、命令、文件变更、审批和 Diff 汇集到一个中文桌面工作台中。

当前版本面向本机开发验证，不包含签名、公证、自动更新或公开分发。

## 快速开始

环境要求：

- macOS（Apple Silicon 或 Intel），或 Windows 10/11（x64）
- Node.js 22 或更高版本
- pnpm 11
- uv（用于按上游固定版本下载并校验 Code Mode 的 V8 构建产物）
- Rust stable toolchain（仅构建固定 sidecar 时需要）

首次拉取并运行：

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm codex:build
pnpm protocol:generate
pnpm dev
```

开发时可以用 `WHALE_CODEX_BIN=/absolute/path/to/codex` 临时覆盖 sidecar。该二进制的
同一目录必须包含配套的 `codex-code-mode-host`（Windows 上为 `.exe`）。未设置时，应用使用
当前平台的 `codex-source/codex-rs/target/release/codex[.exe]`，再回退到 debug 产物。启动前会校验
二进制版本、配套 Code Mode host 与已生成协议清单一致。

## 常用命令

```bash
pnpm codex:build       # 构建固定版本 codex 与配套 Code Mode host
pnpm protocol:generate # 从该二进制生成稳定 TypeScript 与 JSON Schema
pnpm protocol:check    # 检查已提交协议是否漂移
pnpm dev               # 校验 sidecar 后启动开发版
pnpm typecheck         # TypeScript 静态检查
pnpm test              # 单元与组件测试
pnpm test:e2e          # 使用可控假 app-server 测试 Electron/IPC/恢复
pnpm test:package:windows-layout # 在任意开发平台检查 Windows 包内 sidecar 布局
pnpm test:smoke        # 使用真实 sidecar 和临时 CODEX_HOME 冒烟测试
pnpm build             # 生成当前平台的未签名应用目录
pnpm make              # macOS 生成 DMG/ZIP，Windows 生成 Squirrel 安装包
pnpm app:run           # 停止旧实例、构建并启动当前平台应用
pnpm app:verify        # 构建、启动并确认应用保持运行
```

## GitHub 安装包构建

`.github/workflows/package.yml` 直接从 OpenAI 官方 `openai/codex` Release 下载固定版本的
macOS arm64 与 Windows x64 `codex-package`，使用官方 `codex-package_SHA256SUMS` 校验后，
分别在 GitHub 的 macOS 和 Windows 原生 runner 上生成协议并制作安装包。该流程不编译
Codex、不依赖私有 sidecar 缓存，也不需要本地虚拟机、Wine、Rust 或 uv。

可以在 GitHub Actions 中手动选择 `all`、`macos` 或 `windows`。推送与 `package.json`
版本匹配的 `v*` Tag 时，会构建两个平台、生成 `SHA256SUMS.txt`，并自动创建或更新
对应的 GitHub Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

当前安装包仍未签名：DMG 未做 Developer ID 签名或 Apple 公证，Windows 安装器也未做
Authenticode 签名。

## 架构与安全边界

- `src/main` 管理单一 app-server 进程、请求关联、只读过载重试、故障重启、项目记录及
  受限 IPC。
- `src/preload` 只暴露经过运行时校验的 `window.whale` API。Renderer 开启
  `contextIsolation` 和 sandbox，且没有 Node.js、文件系统或任意子进程能力。
- `src/renderer` 提供项目/线程导航、流式会话、工具活动、内联审批、输入与 Diff 面板。
- `src/shared` 是 IPC 和运行时事件的公共边界；`src/generated/protocol` 来自固定
  sidecar，默认不启用实验协议。
- `codex-source` 是只读上游子模块，不在本项目内修改。

Whale Buddy 不读取或修改系统用户的 `~/.codex` 或 `~/.agents`。sidecar 的 `HOME` 固定为
Electron `userData/sidecar-home`，`CODEX_HOME` 固定为 `userData/codex-home`。扩展运行时
采用显式允许名单：不接入 Codex 内置 Skills、`codex_apps` 或 OpenAI 预设远程商城，
也不会自动发现项目商城。Whale 初始没有任何商城；商城目录和插件必须由用户明确启用；
启用插件时，其贡献的 Skills 与 MCP 默认全部开启，之后仍可逐项停用；
未启用内容即使已有缓存也不会进入 app-server 运行快照。UI 状态放在相邻的
`userData/ui-state`，诊断
日志放在 `userData/logs`。自定义 Provider 的 API Key 以明文写入
`userData/ui-state/runtime-settings.json`（macOS 使用 `0600`；Windows 继承当前用户目录 ACL），并通过 sidecar 的环境变量提供；
renderer 默认只能读取“是否已保存”，用户点击设置页的显示按钮后才会读取明文。密钥不会进入
Codex `config.toml`、命令行参数或 renderer 的 `localStorage`，关闭设置页后也会从表单状态中清除。

## 网络与自定义 Provider

设置中的“网络”区域可为 Whale Buddy 独立选择继承启动环境、自定义代理或关闭代理。
自定义代理会同时提供给 sidecar 的 HTTP、HTTPS 与 ALL proxy 环境变量，不会影响系统
或 Codex CLI 的网络配置。

Whale Buddy 不提供 ChatGPT/OpenAI 账号登录，只支持通过 Provider API Key 连接实现
Responses API 的服务。首次启动必须填写 Provider ID、Base URL、原始模型 ID 和 API Key；
Base URL 应是 API 根地址（通常以 `/v1` 结尾），不要包含末尾的 `/responses`。

使用 MiniMax-M3 时可手动填写 Provider ID `minimax_token_plan`、Responses Base URL
`https://api.minimaxi.com/v1`、模型 ID `MiniMax-M3` 和 API Key。Whale Buddy 会对这组
配置应用 1,000,000 token 上下文设置，并在 `userData/ui-state/model-catalogs` 中维护
MiniMax-M3 的 Codex 模型能力目录。该目录声明 reasoning、工具和输入模态，避免 Codex
退回通用模型元数据。

## 使用提示

- `Cmd/Ctrl+O` 打开项目，`Cmd/Ctrl+N` 新建线程，`Cmd/Ctrl+K` 打开命令面板，
  `Cmd/Ctrl+Shift+D` 切换 Diff 面板。
- 输入区支持 Enter 发送、Shift+Enter 换行、Esc 中断、图片附件和 `@文件` 搜索。
- 执行中的线程再次发送内容会使用 `turn/steer`，不会重放原始请求。
- 高权限审批或沙箱模式会在设置中显示醒目警告。

### 插件、Skills 与 MCP

左侧底部的“插件商城”使用固定 sidecar 的稳定 app-server 接口，不启用实验性的
`plugin/search`。商城搜索在已加载目录中本地完成：

- “插件”把下载和启用分成两步。下载只写入 Whale 私有缓存；启用时默认打开该插件的全部
  Skills 与 MCP。插件详情提供 Skill/MCP 圆角预览卡和开关；点击卡片会弹出路径、内容、配置
  及工具预览详情，
  不提供独立工具页。
- “Skills”按当前项目列出已启用插件贡献的 Skill，并允许逐项停用或重新启用。
- “MCP”只列出插件声明的服务，可在插件启用后逐项停用或重新启用。每次停用或卸载插件后
  再启用，插件下的全部 Skills 与 MCP 都恢复为默认开启。
- “商城源”只管理用户手动添加的 Git/本地商城，不包含任何预设来源。开关是运行时授权，
  不是界面过滤；关闭来源会让其插件、Skills 与 MCP
  在 sidecar 重启后全部失效，缓存保持惰性。

插件安装、卸载和商城源移除都会要求显式确认。MCP OAuth URL 只在主进程验证为
HTTP/HTTPS 后交给系统浏览器，不会把登录 URL 或凭据暴露给 renderer。

如果 sidecar 启动失败，可从重连横幅直接打开“连接设置”，或查看应用数据目录中的
`logs/app-server.log`。非空但无法解析的
stdout 会被当作协议故障，应用最多按 0.5、1、2 秒退避重启三次；未确认的写请求不会
自动重放。
