# Whale Buddy Plugin UI SDK

插件仍以标准 `.codex-plugin/plugin.json` 作为唯一入口。Whale UI 扩展放在可选的
`whale` 命名空间内，Codex 会忽略该命名空间，Whale Buddy 会校验并按需加载它。

插件 UI 必须预先构建为位于插件根目录内的 HTML/JS/CSS。每个贡献点运行在独立
iframe 中，没有 Node、文件系统、直接网络或 `window.whale`。插件通过本 SDK 使用：

- `useWhalePlugin()`：读取主题、线程和工具调用上下文。
- `callOwnMcp()`：调用 manifest 白名单中的本插件 MCP 工具。
- `getState()` / `setState()`：保存当前线程范围的 JSON 状态。
- `setComposerContext()` / `clearComposerContext()`：向后续回合附加结构化选择。

当前 API 版本为 `1`，支持 `composer.widget` 与 `mcp.toolCard`。完整清单示例可参考
`marketplaces/xiaojing/plugins/xiaojing-knowledge-base/.codex-plugin/plugin.json`。
