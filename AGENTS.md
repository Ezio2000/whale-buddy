# Whale Buddy 仓库约束

## 构建与部署

- 可运行的 Whale Buddy App、安装包、Codex sidecar 与生成协议只能由
  `.github/workflows/package.yml` 在 GitHub Actions 中构建。
- 本地只允许源码编辑、依赖安装、类型检查、平台边界检查和单元/组件测试。
- 禁止在本地运行 `pnpm codex:build`、`pnpm protocol:generate`、`pnpm build`、
  `pnpm make`、`pnpm app:run`、`pnpm app:verify`，也禁止直接调用 Electron Forge
  的 package/make 命令。
- 本地部署必须下载当前提交对应的 GitHub Actions Artifact，不能使用 `out/`、
  本地 sidecar 或其他本地打包产物。

## Python

如验证脚本需要 Python，必须通过 uv 使用 Python，不得使用 pip 或系统 Python。
