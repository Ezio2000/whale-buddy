# Whale Buddy 企业微信身份包

这是一个可选、可拔除的企业微信扫码身份模块。它只负责：

1. 打开企业微信扫码窗口；
2. 校验 OAuth `state`；
3. 在 Electron 主进程用一次性 `code` 换取企业成员 `UserID`；
4. 尝试读取该成员的姓名、头像、邮箱、手机号和部门 ID；
5. 将规范化后的身份单独保存到 Whale Buddy 用户数据目录下的
   `wecom-auth/identity.json`。

它不提供 RBAC、权限控制、JWT、用户表或对 Whale 其他能力的登录拦截。

## 配置

启动 Whale Buddy 的进程需要包含以下环境变量：

```dotenv
WHALE_WECOM_CORP_ID=企业ID
WHALE_WECOM_AGENT_ID=自建应用AgentID
WHALE_WECOM_SECRET=自建应用Secret
WHALE_WECOM_REDIRECT_URI=https://已配置为授权回调域的地址/wecom/callback
```

`WHALE_WECOM_REDIRECT_URI` 的域名和端口必须与企业微信管理后台中自建应用的
“企业微信授权登录 → Web 网页授权回调域”完全一致。扫码窗口会在导航到该地址时
截获 `code`，所以回调页面本身不需要参与换取身份。

企微 Secret 只由 Electron 主进程读取，不会传给渲染进程；但桌面客户端无法像服务端
一样真正保护应用 Secret。该模式适合内部、临时功能。长期生产使用应将 code 换身份放到
独立服务端，客户端只调用身份服务。

## 删除

删除此功能只需：

1. 删除 `packages/wecom-auth/`；
2. 删除主进程、preload 和侧栏中标记为 `Optional WeCom identity package` 的接入代码；
3. 从根 `package.json` 删除 `@whale-buddy/wecom-auth` 依赖并刷新 lockfile。

其他 Whale 功能和数据结构不依赖此包。
