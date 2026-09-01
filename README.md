# Whale Buddy

Whale Buddy 是一个面向 macOS 与 Windows 的 Codex 桌面客户端。它以 Electron、React 和
TypeScript 构建，通过 stdio JSONL 连接仓库中固定版本的 `codex app-server`，并把
Codex 的对话、命令、文件变更、审批和 Diff 汇集到一个中文桌面工作台中。

当前 macOS 版本使用完整 ad-hoc 签名，但不包含 Developer ID 公证或自动更新；Windows
安装器仍未签名。所有可运行 App 和安装包必须由 GitHub Actions 构建，本地只用于源码
编辑与静态、单元测试验证，禁止生成或部署本地构建产物。

## 获取与安装

唯一支持的安装来源是当前目标提交触发的 GitHub Actions Artifact。提交并推送代码后，
通过 **Actions → Package desktop installers → Run workflow** 选择目标平台，或执行：

```bash
gh workflow run package.yml --repo Ezio2000/whale-buddy --ref main -f platform=macos
```

部署前必须确认工作流成功，并且 `headSha` 与准备部署的提交完全一致：

```bash
git rev-parse HEAD
gh run view <RUN_ID> --repo Ezio2000/whale-buddy \
  --json headSha,status,conclusion,url
gh run download <RUN_ID> --repo Ezio2000/whale-buddy \
  --name AI-Xiaojing-macOS-arm64
```

macOS Artifact 同时包含 DMG 和 ZIP；Windows Artifact 包含 Squirrel 安装文件。不得使用
其他提交的 Artifact，也不得使用本地 `out/`、本地 sidecar 或 Electron Forge 产物部署。
macOS 用户无需手动运行 `codesign`；从浏览器下载后如果首次启动被 Gatekeeper 拦截，可在
**系统设置 → 隐私与安全性** 中选择“仍要打开”。

## 本地源码验证

本地验证环境要求：

- macOS（Apple Silicon 或 Intel），或 Windows 10/11（x64）
- Node.js 22 或更高版本
- pnpm 11

首次拉取后可以执行：

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm platform:check
```

本地不得运行 `pnpm codex:build`、`pnpm protocol:generate`、`pnpm build`、`pnpm make`、
`pnpm app:run`、`pnpm app:verify` 或直接调用 Electron Forge 的 package/make 命令。
协议生成、官方 sidecar 下载、平台打包和安装产物制作统一由
`.github/workflows/package.yml` 完成。本地验证结束后，应通过 `git status --short --branch`
确认没有意外修改；需要保持无本地缓存时，还应确认 `node_modules/`、`out/`、`.sidecar/`
和 `codex-source/codex-rs/target/` 均不存在。

## 常用命令

```bash
pnpm install --frozen-lockfile # 按锁文件安装测试依赖
pnpm typecheck         # TypeScript 静态检查
pnpm platform:check    # 检查平台差异没有越过策略目录边界
pnpm test              # 单元与组件测试
```

`pnpm protocol:check` 和 `pnpm test:package:windows-layout` 都需要固定 sidecar，后者还会
生成本地测试包，因此不属于本地验证命令。协议生成和安装包布局由 GitHub Actions 在下载
并校验官方 sidecar 后覆盖验证。

## GitHub 安装包构建（唯一支持的构建方式）

`.github/workflows/package.yml` 直接从 OpenAI 官方 `openai/codex` Release 下载固定版本的
macOS arm64 与 Windows x64 `codex-package`，使用官方 `codex-package_SHA256SUMS` 校验后，
分别在 GitHub 的 macOS 和 Windows 原生 runner 上生成协议并制作安装包。该流程不编译
Codex、不依赖私有 sidecar 缓存，也不需要本地虚拟机、Wine、Rust 或 uv。

禁止使用本地 sidecar、`out/` 目录或本地 Electron Forge 产物部署。工作流有两种触发方式。

### 手动构建

进入 GitHub 仓库的 **Actions → Package desktop installers → Run workflow**，选择：

- `all`：并行构建 macOS arm64 和 Windows x64；
- `macos`：只构建 DMG 和 ZIP；
- `windows`：只构建 Squirrel `Setup.exe`、NUPKG 和 `RELEASES`。

也可以使用 GitHub CLI：

```bash
gh workflow run package.yml --repo Ezio2000/whale-buddy --ref main -f platform=all
```

手动运行只在 Actions 运行页面底部生成 Artifacts，不会创建正式 GitHub Release。可使用
网页下载，或执行：

```bash
gh run list --repo Ezio2000/whale-buddy --workflow package.yml \
  --branch main --event workflow_dispatch --limit 5
gh run view <RUN_ID> --repo Ezio2000/whale-buddy \
  --json headSha,status,conclusion,url
gh run download <RUN_ID> --repo Ezio2000/whale-buddy \
  --name AI-Xiaojing-macOS-arm64
```

### Tag 自动发布

`package.json` 的版本必须与 Tag 一致。推送匹配的 `v*` Tag 后，工作流会自动构建两个
平台、生成 `SHA256SUMS.txt`，并创建或更新对应的 GitHub Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

版本不一致（例如 `package.json` 为 `0.1.0`，Tag 为 `v0.2.0`）时会立即停止发布。

### 私有仓库额度不足时

GitHub Free 私有仓库的 Actions 分钟耗尽或被 spending limit 阻止时，标准 runner 不会
启动。若确认源码可以短暂公开，可在仓库 **Settings → General → Danger Zone → Change
repository visibility** 中临时改为 Public，触发并等待工作流完成后立即改回 Private。
公开期间源码、Git 历史和 Actions 日志对所有人可见，已经被克隆的内容无法收回。

当前实测耗时约为 macOS 1 分 28 秒、Windows 3 分 41 秒。仓库保持 Private 时，也可以
等待每月免费额度重置，或为 Actions 配置付款方式和月度预算。

macOS App 在 GitHub Actions 中进行完整 ad-hoc 签名并通过严格签名验证，但 DMG 未做
Developer ID 签名或 Apple 公证；Windows 安装器也未做 Authenticode 签名。

## 架构与安全边界

- `src/main` 管理单一 app-server 进程、请求关联、只读过载重试、故障重启、项目记录及
  受限 IPC。
- `src/preload` 只暴露经过运行时校验的 `window.whale` API。Renderer 开启
  `contextIsolation` 和 sandbox，且没有 Node.js、文件系统或任意子进程能力。
- `src/renderer` 提供项目/线程导航、流式会话、工具活动、内联审批、输入与 Diff 面板。
- `src/platform/macos` 与 `src/platform/windows` 分别实现路径、窗口、菜单、生命周期、文件
  权限、sidecar 和安装包布局差异；应用代码只依赖统一平台接口。sandbox preload 使用同一
  平台目录下的轻量入口，不会加载主进程文件系统模块。
- `scripts/platform/macos` 与 `scripts/platform/windows` 隔离平台打包、启动和进程管理差异；
  `pnpm platform:check` 会阻止平台判断重新散落到业务代码、Forge 配置或通用脚本。
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

Whale 自身的用户身份与模型 Provider 相互独立。用户点击“登录 Whale”后，主进程使用
OIDC Authorization Code + PKCE 打开 Casdoor Web 登录页；登录方式由 Casdoor
Application 统一提供，Whale 不包含 Mock、企业微信等 Provider 专用分支。Casdoor 完成
授权后回调 Whale 临时监听的 `http://127.0.0.1:17891/oauth/callback`，浏览器显示登录完成，
Whale 保存账户会话并更新侧边栏。当前源码中的固定 Issuer 是本地联调地址
`http://127.0.0.1:8001`；正式打包前只需将主进程的固定认证配置替换为统一 Casdoor
服务地址，终端用户无需填写认证参数。

设置页的“模型”区域可查看并配置上下文窗口、视觉输入、推理能力、支持的推理档位、
默认推理档位和推理摘要。保存后 Whale Buddy 会在
`userData/ui-state/model-catalogs/runtime-model.json` 生成当前 Provider 专用的 Codex 模型
能力目录，并随 sidecar 重启一起生效。旧配置升级时使用 128,000 token、文本输入和常用
推理档位作为默认值；模型 ID 包含 `vision`、`vl`、`omni` 或 `multimodal` 时会默认开启
视觉输入，之后仍可在设置中修改。

使用 MiniMax-M3 时可手动填写 Provider ID `minimax_token_plan`、Responses Base URL
`https://api.minimaxi.com/v1`、模型 ID `MiniMax-M3` 和 API Key。Whale Buddy 会对这组
旧配置自动迁移为 1,000,000 token 上下文、文本与视觉输入，以及“关闭 / 高”两个推理
档位；这些能力同样可以在设置页继续调整。

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
  Skills 与 MCP。插件详情提供紧凑的 Skill/MCP 清单和开关，不提供独立工具页。
- “Skills”列出当前项目扫描到的 Skill，包括已下载但整插件尚未启用的静态声明；列表状态
  只表示可见与开关结果，未启用插件的 Skill 不会注入线程。选择条目后在右侧查看内容。
- “MCP”合并当前运行时服务与已下载插件的静态 MCP 声明。整插件未启用时仍显示服务并标记
  “未启用”；插件已启用但单个 MCP 关闭时显示“已停用”；配置已开启但服务尚未上报时显示
  “未载入”。未载入时仍可在右侧查看 `.mcp.json`，工具清单要等运行时载入后发现。
- 插件启用后可逐项停用或重新启用 Skill/MCP。每次停用或卸载插件后再启用，插件下的全部
  Skills 与 MCP 都恢复为默认开启。
- 插件可在 `whale.credentials` 中声明凭据。Whale 会在插件详情中生成明文
  输入框，并把值直接写入 `userData/ui-state/plugin-credentials.json`；renderer 和插件
  iframe 都能读取完整值。相关插件和 MCP 启用时，Whale 会向 sidecar 注入声明的环境变量；
  缺少必填凭据时插件不能启用。同一商城内使用相同 `key` 的插件共享一份凭据。
- Whale 插件协议固定为 `whale.apiVersion: 2`，不读取 v1。`uiContributions` 只描述
  `page`、`action`、`widget`、`card` 四类界面和它们的 placement；`webMcp` 声明工具、
  JSON Schema、作用域和注解。每个启用插件只有一个持久 runtime iframe，UI 通过工具调用
  它，Host Services 统一处理生命周期、凭据、MCP 权限、global/project/thread 状态、
  输入上下文和事件。
- WebMCP 工具会在浏览器提供 `document.modelContext` 时原生注册，同时桥接为新建 Codex
  线程的 dynamic tools；工具执行结果回到同一 app-server 请求。SDK 拆为
  `@whale-buddy/plugin-sdk/ui` 和 `@whale-buddy/plugin-sdk/runtime` 两个入口。
- “商城源”只管理用户手动添加的 Git/本地商城，不包含任何预设来源。开关是运行时授权，
  不是界面过滤；关闭来源会让其插件、Skills 与 MCP
  在 sidecar 重启后全部失效，缓存保持惰性。

插件安装、卸载和商城源移除都会要求显式确认。MCP OAuth URL 只在主进程验证为
HTTP/HTTPS 后交给系统浏览器，不会把登录 URL 或凭据暴露给 renderer。

Xiaojing 的知识库和 Outlook 插件都声明共享凭据 `aihub/token`。下载插件后，在插件详情
填写一次 AIHub Token；Whale 会为对应 MCP 提供 `AIHUB_MCP_TOKEN`。这一机制完全位于
Whale 宿主层，不修改官方 Codex sidecar 或 app-server 协议。

如果 sidecar 启动失败，可从重连横幅直接打开“连接设置”，或查看应用数据目录中的
`logs/app-server.log`。非空但无法解析的
stdout 会被当作协议故障，应用最多按 0.5、1、2 秒退避重启三次；未确认的写请求不会
自动重放。
