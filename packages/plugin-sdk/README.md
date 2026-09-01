# Whale Buddy Plugin SDK v2

插件仍以 `.codex-plugin/plugin.json` 为唯一入口。`whale.apiVersion` 必须为 `2`；v2
把界面声明放在 `uiContributions`，把可执行能力放在 `webMcp`。Whale 不读取旧版清单。

## 两个入口

- `@whale-buddy/plugin-sdk/ui` 用于 UI iframe：`usePluginContext()`、按
  global/project/thread 范围读写的 `getState()` / `setState()`、`invokeTool()`、
  `callMcp()` 和宿主事件。
- `@whale-buddy/plugin-sdk/runtime` 用于每个已启用插件唯一、持久的后台 iframe。
  `definePluginRuntime()` 注册 manifest 中声明的工具；工具处理器通过绑定到当前调用的
  services 访问状态、MCP 和输入上下文。

UI 只负责呈现和收集输入，业务动作应调用 WebMCP 工具。runtime 承担执行；Host Services
负责生命周期、凭据、权限、作用域状态、输入上下文和事件。UI iframe 与 runtime iframe
都不能直接访问 `window.whale`。

## v2 清单

```json
{
  "whale": {
    "apiVersion": 2,
    "uiContributions": [
      {
        "id": "selector",
        "type": "widget",
        "placement": "composer",
        "entry": "./ui/index.html",
        "order": 100
      },
      {
        "id": "home",
        "type": "page",
        "placement": "navigation",
        "entry": "./ui/index.html",
        "title": "服务首页",
        "order": 100
      },
      {
        "id": "quick-action",
        "type": "action",
        "placement": "commandPalette",
        "entry": "./ui/index.html",
        "title": "打开服务",
        "description": "从命令面板打开服务。",
        "keywords": ["service"],
        "order": 100
      },
      {
        "id": "result",
        "type": "card",
        "placement": "message",
        "entry": "./ui/index.html",
        "title": "服务结果",
        "match": {
          "itemTypes": ["mcpToolCall"],
          "server": "vendor-service",
          "tools": ["search"]
        }
      }
    ],
    "webMcp": {
      "entry": "./ui/index.html",
      "tools": [
        {
          "id": "search",
          "name": "vendor_search",
          "title": "搜索服务",
          "description": "搜索当前用户可访问的服务数据。",
          "scope": "project",
          "inputSchema": {
            "type": "object",
            "properties": { "query": { "type": "string" } },
            "required": ["query"]
          },
          "annotations": { "readOnlyHint": true, "untrustedContentHint": true }
        }
      ]
    },
    "permissions": {
      "mcp": [
        { "principal": "webMcp:search", "server": "vendor-service", "tools": ["search"] }
      ]
    },
    "credentials": [
      {
        "id": "service-token",
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

UI 类型包括 `page`、`action`、`widget`、`card`、`panel`。位置由 `placement` 决定；action
支持 `commandPalette`、`threadToolbar`、`composerToolbar`，panel 支持 `turnDetails`。
WebMCP 工具名在所有已启用
插件中必须唯一。

Host 会把 WebMCP 工具注册到可用的 `document.modelContext`，并同时映射成新建 Codex
线程的 dynamic tools；当前 Electron 不支持原生 API 时仍可由 Codex 调用。MCP 权限按
`ui:<contributionId>` 或 `webMcp:<toolId>` 主体逐项声明。
