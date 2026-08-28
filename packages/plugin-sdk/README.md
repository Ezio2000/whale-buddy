# Whale Buddy Plugin UI SDK

插件仍以标准 `.codex-plugin/plugin.json` 作为唯一入口。Whale UI 扩展放在可选的
`whale` 命名空间内，Codex 会忽略该命名空间，Whale Buddy 会校验并按需加载它。

插件 UI 必须预先构建为位于插件根目录内的 HTML/JS/CSS。每个贡献点运行在独立
iframe 中，没有 Node、文件系统、直接网络或 `window.whale`。插件通过本 SDK 使用：

- `useWhalePlugin()`：读取主题、线程、工具调用上下文和完整凭据值。
- `callOwnMcp()`：调用 manifest 白名单中的本插件 MCP 工具。
- `getState()` / `setState()`：保存当前线程范围的 JSON 状态。
- `setComposerContext()` / `clearComposerContext()`：向后续回合附加结构化选择。

当前 API 版本为 `1`。iframe SDK 对应 `composer.widget` 与 `mcp.toolCard`；宿主清单还
支持无需 iframe 的 `credential` 贡献点。`credential` 声明凭据元数据和使用它的
MCP；值以明文保存在本机，并通过 `useWhalePlugin().credentials` 传给插件 iframe。完整清单示例可参考
`marketplaces/xiaojing/plugins/xiaojing-knowledge-base/.codex-plugin/plugin.json`。

```json
{
  "whale": {
    "apiVersion": 1,
    "contributions": [
      {
        "id": "service-token",
        "type": "credential",
        "key": "vendor/service-token",
        "credentialType": "bearerToken",
        "label": "Service Token",
        "description": "用于访问插件的远程 MCP 服务。",
        "env": "VENDOR_SERVICE_TOKEN",
        "required": true,
        "scope": "marketplace",
        "usedBy": { "mcpServers": ["vendor-service"] }
      }
    ]
  }
}
```

- `credentialType` 支持 `apiKey` 和 `bearerToken`。
- 同一商城内相同 `key` 共享明文值；不同商城不会共享。
- `usedBy.mcpServers` 只能引用当前插件已声明的 MCP，凭据仅在其中至少一个 MCP 启用时注入。
- `env` 必须是以 `_API_KEY`、`_TOKEN`、`_SECRET` 或 `_PASSWORD` 结尾的大写名称。
- HTTP MCP 应在 `.mcp.json` 的 `bearer_token_env_var` 中引用同一个 `env` 名称。
