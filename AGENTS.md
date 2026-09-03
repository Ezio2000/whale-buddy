# Whale Buddy 仓库约束

## 构建与部署

- 可运行的 Whale Buddy App、安装包、Codex sidecar 与生成协议只能由
  `.github/workflows/package.yml` 在 GitHub Actions 中构建。
- 本地只允许源码编辑、依赖安装、类型检查、平台边界检查和单元/组件测试。
- 禁止在本地运行 `pnpm codex:build`、`pnpm protocol:generate`、`pnpm build`、
  `pnpm make`、`pnpm app:run`、`pnpm app:verify`，也禁止直接调用 Electron Forge
  的 package/make 命令。
- 禁止在本地构建、打包或启动应用：`pnpm dev`、`pnpm start` 与任何
  electron-forge start 调用都不允许，即使仅为界面目检或验证改动。
- 禁止在本地下载或修复 Electron 二进制（如运行
  `node node_modules/electron/install.js`）。测试因本地 Electron 二进制缺失而
  失败时视为环境问题，不要修复本地环境，直接推送后由 GitHub Actions 验证。
- 本地部署必须下载当前提交对应的 GitHub Actions Artifact，不能使用 `out/`、
  本地 sidecar 或其他本地打包产物。
- 触发工作流时必须显式传入目标 `--ref`；下载前检查 Actions run 的 `headSha` 与
  `git rev-parse HEAD` 一致，并确认结论为 `success`。
- 仓库中的 `.codex/environments/environment.toml` 是自动生成的，不能把其中的
  `pnpm app:run` 当作允许的构建或部署入口。

## 本地清洁

- 开始和结束任务时运行 `git status --short --branch`，保留用户已有修改，不提交构建产物。
- 用户要求无本地构建缓存时，先停止相关进程，再精确清理仓库内的 `node_modules/`、`out/`、
  `.sidecar/` 和 `codex-source/codex-rs/target/`；不得连带删除全局 pnpm、Cargo 或 uv 缓存。
- GitHub Artifact 只能下载到临时目录；部署并验证后删除临时下载与解包目录。
- 替换已安装 App 时不得删除 `~/Library/Application Support/Whale Buddy`。部署前后应核对
  关键配置文件，确认 Provider、插件策略和用户数据保持不变。

## Python

如验证脚本需要 Python，必须通过 uv 使用 Python，不得使用 pip 或系统 Python。
