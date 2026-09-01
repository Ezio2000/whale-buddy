# Casdoor 一键部署

这是一个可以脱离 Whale Buddy 仓库独立运行的 Casdoor 部署包。上传或复制时只需要
`third/casdoor/` 这一个目录；Compose 只拉取官方预构建镜像，不构建、复制或挂载 Whale
Buddy 源码。

## 环境要求

- Linux 或 macOS
- Docker Engine / Docker Desktop
- Docker Compose v2.2 或更高版本
- 正式部署需要一个可以从 Docker 访问的外部 MySQL

当前固定镜像版本为 `3.164.0`。不要把长期环境改成 `latest`；需要升级时使用明确版本号。

## 快速体验

体验环境使用内置 SQLite，默认监听 `8001`，只适合临时查看：

```bash
chmod +x deploy.sh
./deploy.sh demo
```

打开 `http://127.0.0.1:8001`，使用：

- Organization：`built-in`
- Username：`admin`
- Password：`123`

停止并删除体验容器：

```bash
./deploy.sh demo-stop
```

删除体验容器会丢失其中的 SQLite 数据。

## 轻量 OAuth Mock（仅测试）

本部署包附带一个带假扫码界面的标准 OAuth/OIDC Mock，用来验证 Casdoor 的 Custom OAuth
登录、授权回调和自动创建用户。电脑端会显示二维码，手机扫码确认后，电脑端自动完成
OAuth 回调。它模拟的是企业微信的扫码体验，不包含真实企业微信的 `CorpID`、`AgentID`、
通讯录或专有 API，禁止用于生产。

启动 Casdoor 体验环境和 Mock：

```bash
./deploy.sh demo
./deploy.sh oauth-mock
./deploy.sh oauth-mock-test
```

Mock 只有一个容器，不构建或挂载源码。部署包内提供 Linux x64/ARM64 两个预编译小程序，
容器使用固定 digest 的 Alpine 镜像；基础镜像约 4.1 MB，本机实测运行内存约 13 MiB。
扫码后模拟的固定身份为：

- Email：`alice@mock.wecom.local`
- Username：`alice`

扫码流程：

1. 在 Casdoor 登录页点击 `Local OAuth Mock`；
2. 电脑浏览器显示二维码并轮询扫码状态；
3. 手机扫描二维码，打开确认页并点击 `确认登录`；
4. 电脑浏览器自动回调 Casdoor，Casdoor 登录或创建 `alice` 用户。

手机和 Docker 主机需要在同一局域网。`./deploy.sh oauth-mock` 会自动检测局域网 IP 并将
它编码进二维码；如果检测结果不适用，在 `.env` 中明确设置：

```dotenv
OAUTH_MOCK_SCAN_BASE_URL=http://192.168.1.10:9000
```

### Whale 桌面登录联调

一个命令启动 Casdoor、OAuth Mock，并创建专用的 `whale` Organization 与
`app-whale` OIDC Application：

```bash
./deploy.sh whale-auth-demo
```

该命令固定配置 Whale 客户端参数，终端用户不需要填写：

| 配置 | 固定值 |
| --- | --- |
| Issuer | `http://127.0.0.1:8001` |
| Client ID | `whale-buddy-desktop` |
| Client Secret | `whale-buddy-desktop-secret` |
| Redirect URI | `http://127.0.0.1:17891/oauth/callback` |
| Scope | `openid profile email offline_access` |

`app-whale` 默认显示密码登录和 `Local OAuth Mock`。将来接入企业微信时，只需在
Casdoor 中为这个 Application 增加 WeCom Provider，Whale 不需要增加企业微信专用代码。

重复检查运行状态和配置：

```bash
./deploy.sh whale-auth-check
```

在 Casdoor 的 `Providers` 中新增一个 Provider，填写：

| 字段 | 值 |
| --- | --- |
| Name | `provider_oauth_mock` |
| Category | `OAuth` |
| Type | `Custom` |
| Client ID | `casdoor-mock-client` |
| Client Secret | `casdoor-mock-secret` |
| Auth URL | `http://127.0.0.1:9000/api/v1/authorize` |
| Scope | `openid profile email` |
| Token URL | `http://host.docker.internal:9000/api/v1/token` |
| UserInfo URL | `http://host.docker.internal:9000/api/v1/userinfo` |

Custom Provider 的 User mapping 还要填写以下四项；当前 Casdoor 版本缺少它们会拒绝读取
UserInfo：

| Casdoor 字段 | Mock claim |
| --- | --- |
| `id` | `sub` |
| `username` | `name` |
| `displayName` | `name` |
| `email` | `email` |

然后在用于测试的 Casdoor Application 中加入 `provider_oauth_mock`，打开 `Can sign up` 和
`Can sign in`。建议使用单独的测试 Organization/Application；`built-in` Organization 默认
禁止第三方登录自动创建用户，因为其中的用户拥有全局管理权限。若只在可随时删除的本地
体验环境中测试 `app-built-in`，需要先在 `built-in` Organization 设置中临时打开
`Has privilege consent`，测试后立即关闭。

Auth URL 使用 `127.0.0.1`，因为它由浏览器访问；Token 和 UserInfo URL 使用
`host.docker.internal`，因为它们由 Casdoor 容器访问。预置回调地址包含本机 `8000` 和
`8001` 端口的 `localhost`/`127.0.0.1` 形式。若 Casdoor 使用其他端口，需要同步修改
`compose.oauth-mock.yaml` 中的 `ALLOWED_REDIRECT_URIS`，然后执行：

```bash
./deploy.sh oauth-mock-stop
./deploy.sh oauth-mock
```

查看或停止 Mock：

```bash
./deploy.sh oauth-mock-status
./deploy.sh oauth-mock-logs
./deploy.sh oauth-mock-stop
```

## 正式部署

先创建并编辑配置：

```bash
./deploy.sh init
vi .env
```

关键配置：

- `CASDOOR_ORIGIN`：最终访问地址，例如 `http://10.0.0.8:8000` 或
  `https://auth.example.com`。
- `MYSQL_HOST`：外部 MySQL 地址；Docker Desktop 访问本机 MySQL 时使用
  `host.docker.internal`。
- `MYSQL_ADMIN_*`：具备建库、建用户和授权能力的管理账号，只用于短生命周期客户端。
- `MYSQL_APP_*`：Casdoor 容器长期使用的数据库业务账号。
- `REGISTRY_PREFIX`：可选的 Docker Hub 镜像代理前缀；留空即使用官方仓库。

`.env` 同时由 Bash 和 Docker Compose 读取，带特殊字符的值应使用单引号包裹。
`MYSQL_APP_PASSWORD` 支持字母、数字以及 `._~!#%^*+=:@-`，不要使用空格、美元符号、
引号或反斜杠。

检查并部署：

```bash
./deploy.sh doctor
./deploy.sh deploy
```

如果目标机器无法稳定直连 Docker Hub，可以在 `.env` 中长期设置兼容 Docker Hub 路径的
镜像代理前缀，也可以只为单次命令覆盖：

`.env` 中长期设置：

```dotenv
REGISTRY_PREFIX=docker.example.com
```

单次覆盖：

```bash
./deploy.sh deploy --registry-prefix docker.example.com
```

脚本会分别拉取 `docker.example.com/casbin/casdoor:<版本>` 和
`docker.example.com/library/mysql:8.0`。该参数不会修改 Docker daemon 或 Docker Desktop
的全局镜像源。命令行参数优先于 `.env`；两处均未设置时使用 Docker Hub 官方地址。前缀
必须是镜像引用中的主机名和可选路径，不能包含用户名、密码或 URL 查询参数；
`http://`、`https://` 和末尾斜杠会被自动移除。

`doctor`、`demo`、`deploy`、`backup`、`restore` 和 `update` 都接受
`--registry-prefix HOST`。其余命令不会拉取或临时运行镜像，因此不需要该参数。

部署脚本将：

1. 验证部署包和 Docker 环境；
2. 使用临时 `mysql:8.0` 客户端连接外部 MySQL；
3. 创建数据库和业务账号并授权；
4. 拉取固定版本 Casdoor 镜像；
5. 启动服务并等待 `/api/health`。

Casdoor 默认监听宿主机 `8000`。本目录不包含 HTTPS 反向代理；如果外部已有
Nginx/Caddy，应把 `CASDOOR_ORIGIN` 设置为最终 HTTPS 地址，并由反向代理转发至 8000。

首次登录仍使用 `built-in / admin / 123`，必须立即修改密码。

## 运维命令

```bash
./deploy.sh status
./deploy.sh logs
./deploy.sh restart
./deploy.sh stop
./deploy.sh backup
./deploy.sh restore backups/production-YYYYMMDD-HHMMSS/database.sql.gz
./deploy.sh update 3.165.0
./deploy.sh uninstall
```

- 备份位于 `backups/`，包含压缩 SQL、当时的环境配置和版本清单。
- 恢复前必须输入 `RESTORE`，恢复过程会短暂停止 Casdoor。
- `update` 会先自动备份，再拉取指定的固定版本并执行健康检查。
- `uninstall` 不删除外部 MySQL、备份或 Docker 日志卷。

## 内部 Docker 测试

测试命令会把允许分发的文件复制到独立临时目录，只从该目录启动测试。测试栈包含临时
MySQL 和 Casdoor，不会读取或上传 Whale Buddy 源码：

```bash
./deploy.sh bundle-check
./deploy.sh test
```

测试覆盖健康接口、运行镜像版本、OIDC Discovery、登录页、容器重启、数据库备份与恢复。成功后只
清理 `whale-buddy-casdoor-test` project 创建的容器、网络和卷；失败时会保留隔离目录和测试
容器，并打印检查及清理命令。

## 常见问题

查看最近日志：

```bash
docker compose --env-file .env -p whale-buddy-casdoor -f compose.yaml logs --tail=200 casdoor
```

检查运行镜像版本：

```bash
docker inspect --format '{{.Config.Image}}' whale-buddy-casdoor-casdoor-1
```

如果 MySQL 在宿主机，请确认它允许来自 Docker 网络的连接；如果 MySQL 位于其他服务器，
还要确认防火墙、监听地址和管理账号的来源主机授权。
