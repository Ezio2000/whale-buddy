# Whale Buddy Plugin UI SDK

插件仍以标准 `.codex-plugin/plugin.json` 作为唯一入口。Whale UI 扩展放在可选的
`whale` 命名空间内，Codex 会忽略该命名空间，Whale Buddy 会校验并按需加载它。

插件 UI 必须预先构建为位于插件根目录内的 HTML/JS/CSS。每个贡献点运行在独立
iframe 中，没有 Node、文件系统、直接网络或 `window.whale`。插件通过本 SDK 使用：

- `useWhalePlugin()`：读取主题、项目、线程、消息/工具调用上下文和完整凭据值。
- `callOwnMcp()`：调用 manifest 白名单中的本插件 MCP 工具。
- `getState()` / `setState()`：保存当前线程范围的 JSON 状态。
- `setComposerContext()` / `clearComposerContext()`：由 `composer.widget` 或
  `composer.action` 向后续回合附加结构化选择。

当前 API 版本为 `1`。iframe SDK 支持以下 UI 贡献点：

- `navigation.page`：左侧导航中的完整插件页面。
- `command.action`：命令面板中的插件操作，点击后打开插件面板。
- `thread.toolbarAction`：当前线程标题栏中的插件操作。
- `composer.action`：输入区工具栏中的插件操作，可设置结构化输入上下文。
- `message.card`：按消息类型以及可选的 MCP 服务/工具匹配会话消息卡片。
- `composer.widget`、`mcp.toolCard`：为已有插件保留的兼容贡献点。

宿主清单还支持无需 iframe 的 `credential` 贡献点。`credential` 声明凭据元数据和使用它的
MCP；值以明文保存在本机，并通过 `useWhalePlugin().credentials` 传给插件 iframe。完整清单示例可参考
`marketplaces/xiaojing/plugins/xiaojing-knowledge-base/.codex-plugin/plugin.json`。

```json
{
  "whale": {
    "apiVersion": 1,
    "contributions": [
      {
        "id": "home",
        "type": "navigation.page",
        "entry": "./ui/index.html",
        "title": "服务首页",
        "order": 100
      },
      {
        "id": "quick-action",
        "type": "command.action",
        "entry": "./ui/index.html",
        "title": "打开服务",
        "description": "从命令面板打开服务。",
        "keywords": ["service"],
        "order": 100
      },
      {
        "id": "thread-action",
        "type": "thread.toolbarAction",
        "entry": "./ui/index.html",
        "title": "线程服务",
        "order": 100
      },
      {
        "id": "composer-action",
        "type": "composer.action",
        "entry": "./ui/index.html",
        "title": "选择数据",
        "order": 100
      },
      {
        "id": "result-card",
        "type": "message.card",
        "entry": "./ui/index.html",
        "title": "服务结果",
        "itemTypes": ["mcpToolCall"],
        "server": "vendor-service",
        "tools": ["search"],
        "order": 100
      },
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
