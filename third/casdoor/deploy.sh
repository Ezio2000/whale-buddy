#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
TEST_ENV_FILE="$SCRIPT_DIR/.env.test"
PROD_PROJECT="whale-buddy-casdoor"
DEMO_PROJECT="whale-buddy-casdoor-demo"
TEST_PROJECT="whale-buddy-casdoor-test"
OAUTH_MOCK_PROJECT="whale-buddy-casdoor-oauth-mock"
MYSQL_CLIENT_NETWORK=""
ACTIVE_ENV_FILE=""
LAST_BACKUP_FILE=""

info() {
  printf '[casdoor] %s\n' "$*"
}

warn() {
  printf '[casdoor] 警告：%s\n' "$*" >&2
}

die() {
  printf '[casdoor] 错误：%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法：./deploy.sh <命令> [参数]

体验环境：
  demo [镜像选项]      启动 SQLite all-in-one 体验环境（默认端口 8001）
  demo-stop            停止体验环境
  demo-logs            跟踪体验环境日志

OAuth Mock（仅测试）：
  oauth-mock           启动本地标准 OAuth/OIDC Mock（默认端口 9000）
  oauth-mock-status    查看 OAuth Mock 状态
  oauth-mock-logs      跟踪 OAuth Mock 日志
  oauth-mock-test      验证二维码、手机确认、回调、Token 和 UserInfo
  oauth-mock-stop      停止并删除 OAuth Mock

Whale 登录联调：
  whale-auth-demo      一键启动 Casdoor + Mock，并配置 Whale OIDC 客户端
  whale-auth-check     检查 Whale OIDC 客户端、回调和 Mock Provider

正式环境：
  init                 从 .env.example 创建 .env
  doctor [镜像选项]    检查部署包、Docker、配置和 Compose
  deploy [镜像选项]    初始化外部 MySQL 并启动 Casdoor
  status               查看正式环境状态
  logs                 跟踪正式环境日志
  restart              重启正式环境并等待健康
  stop                 停止正式环境
  update [version] [镜像选项]
                       备份后更新固定镜像版本并重新部署
  backup [镜像选项]    备份数据库、配置和版本信息
  restore <sql.gz> [镜像选项]
                       确认后恢复指定数据库备份
  uninstall            删除正式容器和网络，保留日志卷、数据库与备份

镜像选项：
  --registry-prefix HOST
                       临时覆盖 .env 中的 REGISTRY_PREFIX

测试：
  bundle-check         检查部署目录不包含源码、构建上下文或源码挂载
  test                 在隔离目录和内部 Docker 中运行端到端测试
  test-clean           清理本部署包创建的测试容器、网络和卷
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

require_docker() {
  require_command docker
  docker info >/dev/null 2>&1 || die "Docker daemon 不可用"
  docker compose version >/dev/null 2>&1 || die "需要 Docker Compose v2"
}

load_env() {
  local file="$1"
  [[ -f "$file" ]] || die "配置文件不存在：${file}；先运行 ./deploy.sh init"
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
  ACTIVE_ENV_FILE="$file"
}

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "缺少配置：$name"
}

validate_common_env() {
  local name
  for name in CASDOOR_VERSION MYSQL_IMAGE MYSQL_HOST MYSQL_PORT MYSQL_DATABASE \
    MYSQL_ADMIN_USER MYSQL_ADMIN_PASSWORD MYSQL_APP_USER MYSQL_APP_PASSWORD; do
    require_var "$name"
  done

  [[ "$CASDOOR_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "CASDOOR_VERSION 必须是固定版本号，不能使用 latest"
  [[ "$MYSQL_PORT" =~ ^[0-9]+$ ]] || die "MYSQL_PORT 必须是数字"
  [[ "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || die "MYSQL_DATABASE 只能包含字母、数字和下划线"
  [[ "$MYSQL_APP_USER" =~ ^[A-Za-z0-9_]+$ ]] || die "MYSQL_APP_USER 只能包含字母、数字和下划线"
  [[ "$MYSQL_APP_PASSWORD" =~ ^[A-Za-z0-9._~!#%^*+=:@-]+$ ]] || \
    die "MYSQL_APP_PASSWORD 包含不支持的字符；请按 .env.example 的说明设置"
}

validate_prod_env() {
  validate_common_env
  require_var CASDOOR_PORT
  require_var CASDOOR_ORIGIN
  [[ "$CASDOOR_PORT" =~ ^[0-9]+$ ]] || die "CASDOOR_PORT 必须是数字"
  [[ "$CASDOOR_ORIGIN" =~ ^https?://[^[:space:]]+$ ]] || die "CASDOOR_ORIGIN 必须是完整的 HTTP/HTTPS URL"
}

configure_registry_prefix() {
  local prefix="$1"
  local mysql_path

  prefix="${prefix#http://}"
  prefix="${prefix#https://}"
  prefix="${prefix%/}"
  [[ "$prefix" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._-]+)*$ ]] || \
    die "镜像代理前缀格式无效：$1"

  if [[ "$MYSQL_IMAGE" == */* ]]; then
    mysql_path="$MYSQL_IMAGE"
  else
    mysql_path="library/$MYSQL_IMAGE"
  fi

  CASDOOR_IMAGE="$prefix/casbin/casdoor:$CASDOOR_VERSION"
  MYSQL_IMAGE="$prefix/$mysql_path"
  export CASDOOR_IMAGE MYSQL_IMAGE
  info "本次操作使用镜像代理前缀：$prefix"
}

configure_demo_registry_prefix() {
  local prefix="$1"
  prefix="${prefix#http://}"
  prefix="${prefix#https://}"
  prefix="${prefix%/}"
  [[ "$prefix" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._-]+)*$ ]] || \
    die "镜像代理前缀格式无效：$1"

  CASDOOR_DEMO_IMAGE="$prefix/casbin/casdoor-all-in-one:${CASDOOR_VERSION:-3.164.0}"
  export CASDOOR_DEMO_IMAGE
  info "本次操作使用镜像代理前缀：$prefix"
}

apply_registry_prefix() {
  local command_prefix="${1:-}"
  local effective_prefix="${command_prefix:-${REGISTRY_PREFIX:-}}"
  if [[ -n "$effective_prefix" ]]; then
    configure_registry_prefix "$effective_prefix"
  fi
}

parse_registry_options() {
  REGISTRY_OPTION_PREFIX=""
  REGISTRY_POSITIONAL_ARGS=()
  while (($#)); do
    case "$1" in
      --registry-prefix)
        [[ $# -ge 2 ]] || die "--registry-prefix 后需要填写主机名"
        REGISTRY_OPTION_PREFIX="$2"
        shift 2
        ;;
      --registry-prefix=*)
        REGISTRY_OPTION_PREFIX="${1#*=}"
        shift
        ;;
      *)
        REGISTRY_POSITIONAL_ARGS+=("$1")
        shift
        ;;
    esac
  done
}

prod_compose() {
  docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" \
    -p "$PROD_PROJECT" -f "$SCRIPT_DIR/compose.yaml" "$@"
}

demo_compose() {
  docker compose --project-directory "$SCRIPT_DIR" -p "$DEMO_PROJECT" \
    -f "$SCRIPT_DIR/compose.demo.yaml" "$@"
}

oauth_mock_compose() {
  docker compose --project-directory "$SCRIPT_DIR" -p "$OAUTH_MOCK_PROJECT" \
    -f "$SCRIPT_DIR/compose.oauth-mock.yaml" "$@"
}

test_compose() {
  docker compose --project-directory "$SCRIPT_DIR" --env-file "$TEST_ENV_FILE" \
    -p "$TEST_PROJECT" -f "$SCRIPT_DIR/compose.test.yaml" "$@"
}

bundle_check() {
  local allowed path relative
  allowed='|.env.example|.env.test|.gitignore|README.md|compose.yaml|compose.demo.yaml|compose.oauth-mock.yaml|compose.test.yaml|deploy.sh|oauth-mock-linux-amd64|oauth-mock-linux-arm64|'

  while IFS= read -r path; do
    relative="${path#"$SCRIPT_DIR"/}"
    case "$relative" in
      .env|backups|backups/*|test-failure.log) continue ;;
    esac
    [[ "$allowed" == *"|$relative|"* ]] || die "部署目录包含未声明文件：$relative"
  done < <(find "$SCRIPT_DIR" -mindepth 1 -maxdepth 2 -print)

  if find "$SCRIPT_DIR" -type l -print -quit | grep -q .; then
    die "部署目录不允许包含符号链接"
  fi

  if grep -En '(^|[[:space:]])(build|context):|\.\./|[[:space:]]-[[:space:]]+[./~].*:' \
    "$SCRIPT_DIR"/compose*.yaml; then
    die "Compose 包含构建上下文、目录越界或宿主机 bind mount"
  fi

  info "部署包隔离检查通过：仅包含 Casdoor 部署文件和镜像引用，不包含源码"
}

mysql_docker_args() {
  MYSQL_DOCKER_ARGS=(docker run --rm --add-host host.docker.internal:host-gateway)
  if [[ -n "$MYSQL_CLIENT_NETWORK" ]]; then
    MYSQL_DOCKER_ARGS+=(--network "$MYSQL_CLIENT_NETWORK")
  fi
  MYSQL_DOCKER_ARGS+=(-e "MYSQL_PWD=$MYSQL_ADMIN_PASSWORD" "$MYSQL_IMAGE")
}

wait_for_mysql() {
  local timeout="${MYSQL_CONNECT_TIMEOUT:-60}"
  mysql_docker_args
  info "等待 MySQL ${MYSQL_HOST}:${MYSQL_PORT}（最多 ${timeout} 秒）"
  "${MYSQL_DOCKER_ARGS[@]}" sh -c '
    timeout="$1"; host="$2"; port="$3"; user="$4"; elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
      if mysqladmin ping --protocol=TCP -h "$host" -P "$port" -u "$user" --connect-timeout=3 --silent; then
        exit 0
      fi
      sleep 2
      elapsed=$((elapsed + 2))
    done
    exit 1
  ' sh "$timeout" "$MYSQL_HOST" "$MYSQL_PORT" "$MYSQL_ADMIN_USER" || \
    die "MySQL 在超时时间内不可用"
}

bootstrap_database() {
  local sql
  sql="CREATE DATABASE IF NOT EXISTS \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$MYSQL_APP_USER'@'%' IDENTIFIED BY '$MYSQL_APP_PASSWORD';
ALTER USER '$MYSQL_APP_USER'@'%' IDENTIFIED BY '$MYSQL_APP_PASSWORD';
GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO '$MYSQL_APP_USER'@'%';
FLUSH PRIVILEGES;"

  mysql_docker_args
  info "初始化数据库和 Casdoor 业务账号"
  "${MYSQL_DOCKER_ARGS[@]}" mysql --protocol=TCP -h "$MYSQL_HOST" -P "$MYSQL_PORT" \
    -u "$MYSQL_ADMIN_USER" --connect-timeout=5 -e "$sql"
}

wait_for_http() {
  local url="$1"
  local timeout="${2:-120}"
  local elapsed=0
  require_command curl
  while [[ "$elapsed" -lt "$timeout" ]]; do
    if curl -fsS "$url/api/health" >/dev/null 2>&1; then
      info "Casdoor 健康检查通过：$url"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

prod_url() {
  printf 'http://127.0.0.1:%s' "$CASDOOR_PORT"
}

backup_database() {
  local label="${1:-production}"
  local timestamp backup_dir sql_file
  require_command gzip
  timestamp="$(date '+%Y%m%d-%H%M%S')"
  backup_dir="$SCRIPT_DIR/backups/${label}-${timestamp}"
  sql_file="$backup_dir/database.sql.gz"
  mkdir -p "$backup_dir"
  chmod 700 "$SCRIPT_DIR/backups" "$backup_dir"

  MYSQL_DOCKER_ARGS=(docker run --rm --add-host host.docker.internal:host-gateway)
  if [[ -n "$MYSQL_CLIENT_NETWORK" ]]; then
    MYSQL_DOCKER_ARGS+=(--network "$MYSQL_CLIENT_NETWORK")
  fi
  MYSQL_DOCKER_ARGS+=(-e "MYSQL_PWD=$MYSQL_APP_PASSWORD" "$MYSQL_IMAGE")

  info "备份数据库到 $sql_file"
  "${MYSQL_DOCKER_ARGS[@]}" mysqldump --protocol=TCP -h "$MYSQL_HOST" -P "$MYSQL_PORT" \
    -u "$MYSQL_APP_USER" --single-transaction --routines --triggers --events \
    --set-gtid-purged=OFF --column-statistics=0 --no-tablespaces \
    "$MYSQL_DATABASE" | gzip -9 > "$sql_file"
  gzip -t "$sql_file"
  cp "$ACTIVE_ENV_FILE" "$backup_dir/environment.env"
  printf 'created_at=%s\ncasdoor_version=%s\nmysql_database=%s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$CASDOOR_VERSION" "$MYSQL_DATABASE" \
    > "$backup_dir/manifest.txt"
  chmod 600 "$sql_file" "$backup_dir/environment.env" "$backup_dir/manifest.txt"
  LAST_BACKUP_FILE="$sql_file"
  info "备份完成：$sql_file"
}

restore_database() {
  local sql_file="$1"
  local compose_mode="${2:-production}"
  [[ -f "$sql_file" ]] || die "备份文件不存在：$sql_file"
  gzip -t "$sql_file" || die "备份文件不是有效的 gzip SQL"

  if [[ "${CASDOOR_ASSUME_YES:-0}" != "1" ]]; then
    printf '恢复会覆盖数据库 %s，输入 RESTORE 继续：' "$MYSQL_DATABASE"
    local answer
    read -r answer
    [[ "$answer" == "RESTORE" ]] || die "已取消恢复"
  fi

  if [[ "$compose_mode" == "test" ]]; then
    test_compose stop casdoor >/dev/null
  else
    prod_compose stop casdoor >/dev/null
  fi

  MYSQL_DOCKER_ARGS=(docker run --rm -i --add-host host.docker.internal:host-gateway)
  if [[ -n "$MYSQL_CLIENT_NETWORK" ]]; then
    MYSQL_DOCKER_ARGS+=(--network "$MYSQL_CLIENT_NETWORK")
  fi
  MYSQL_DOCKER_ARGS+=(-e "MYSQL_PWD=$MYSQL_APP_PASSWORD" "$MYSQL_IMAGE")

  info "恢复数据库：$sql_file"
  gzip -dc "$sql_file" | "${MYSQL_DOCKER_ARGS[@]}" mysql --protocol=TCP \
    -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_APP_USER" "$MYSQL_DATABASE"

  if [[ "$compose_mode" == "test" ]]; then
    test_compose up -d casdoor >/dev/null
  else
    prod_compose up -d casdoor >/dev/null
  fi
}

replace_version() {
  local new_version="$1"
  local tmp_file="$ENV_FILE.tmp.$$"
  awk -v version="$new_version" '
    BEGIN { replaced = 0 }
    /^CASDOOR_VERSION=/ { print "CASDOOR_VERSION=" version; replaced = 1; next }
    { print }
    END { if (!replaced) print "CASDOOR_VERSION=" version }
  ' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

run_doctor() {
  local registry_prefix="${1:-}"
  require_docker
  bundle_check
  load_env "$ENV_FILE"
  validate_prod_env
  apply_registry_prefix "$registry_prefix"
  require_command curl
  require_command gzip
  prod_compose config --quiet
  info "配置和 Compose 检查通过"
}

run_deploy() {
  parse_registry_options "$@"
  ((${#REGISTRY_POSITIONAL_ARGS[@]} == 0)) || \
    die "deploy 不支持参数：${REGISTRY_POSITIONAL_ARGS[*]}"
  run_doctor "$REGISTRY_OPTION_PREFIX"
  wait_for_mysql
  bootstrap_database
  info "拉取固定版本 Casdoor 镜像"
  prod_compose pull casdoor
  prod_compose up -d casdoor
  if ! wait_for_http "$(prod_url)" "${CASDOOR_START_TIMEOUT:-120}"; then
    prod_compose logs --tail=200 casdoor >&2 || true
    die "Casdoor 启动后未通过健康检查"
  fi
  info "部署完成：${CASDOOR_ORIGIN}"
  warn "首次登录请使用 built-in / admin / 123，并立即修改默认密码"
}

run_demo() {
  parse_registry_options "$@"
  ((${#REGISTRY_POSITIONAL_ARGS[@]} == 0)) || \
    die "demo 不支持参数：${REGISTRY_POSITIONAL_ARGS[*]}"
  require_docker
  bundle_check
  if [[ -f "$ENV_FILE" ]]; then
    load_env "$ENV_FILE"
  fi
  local registry_prefix="${REGISTRY_OPTION_PREFIX:-${REGISTRY_PREFIX:-}}"
  if [[ -n "$registry_prefix" ]]; then
    configure_demo_registry_prefix "$registry_prefix"
  fi
  demo_compose pull casdoor-demo
  demo_compose up -d casdoor-demo
  local port="${CASDOOR_DEMO_PORT:-8001}"
  if ! wait_for_http "http://127.0.0.1:$port" "${CASDOOR_START_TIMEOUT:-120}"; then
    demo_compose logs --tail=200 casdoor-demo >&2 || true
    die "体验环境未通过健康检查"
  fi
  info "体验环境：http://127.0.0.1:${port}（built-in / admin / 123）"
}

oauth_mock_url() {
  printf 'http://127.0.0.1:%s' "${OAUTH_MOCK_PORT:-9000}"
}

wait_for_oauth_mock() {
  local url timeout elapsed
  url="$(oauth_mock_url)"
  timeout="${OAUTH_MOCK_START_TIMEOUT:-60}"
  elapsed=0
  require_command curl
  while [[ "$elapsed" -lt "$timeout" ]]; do
    if curl -fsS "$url/api/v1/ping" >/dev/null 2>&1; then
      info "OAuth Mock 健康检查通过：$url"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

load_optional_env() {
  if [[ -f "$ENV_FILE" ]]; then
    load_env "$ENV_FILE"
  fi
}

detect_lan_ip() {
  local ip=""
  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
    [[ -n "$ip" ]] || ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  elif command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s' "$ip"
}

configure_oauth_mock_scan_url() {
  local ip
  if [[ -n "${OAUTH_MOCK_SCAN_BASE_URL:-}" ]]; then
    export OAUTH_MOCK_SCAN_BASE_URL
    return
  fi
  ip="$(detect_lan_ip)"
  if [[ -n "$ip" ]]; then
    OAUTH_MOCK_SCAN_BASE_URL="http://${ip}:${OAUTH_MOCK_PORT:-9000}"
  else
    OAUTH_MOCK_SCAN_BASE_URL="http://127.0.0.1:${OAUTH_MOCK_PORT:-9000}"
    warn "未检测到局域网 IP，二维码只能在本机打开；可在 .env 设置 OAUTH_MOCK_SCAN_BASE_URL"
  fi
  export OAUTH_MOCK_SCAN_BASE_URL
}

run_oauth_mock() {
  require_docker
  bundle_check
  load_optional_env
  configure_oauth_mock_scan_url
  chmod 755 "$SCRIPT_DIR/oauth-mock-linux-amd64" "$SCRIPT_DIR/oauth-mock-linux-arm64"
  oauth_mock_compose config --quiet
  oauth_mock_compose pull oauth-mock
  oauth_mock_compose up -d oauth-mock
  if ! wait_for_oauth_mock; then
    oauth_mock_compose logs --tail=200 oauth-mock >&2 || true
    die "OAuth Mock 未通过健康检查"
  fi
  local url
  url="$(oauth_mock_url)"
  info "OAuth Mock 已启动：$url/api/v1/authorize"
  info "二维码手机访问地址：$OAUTH_MOCK_SCAN_BASE_URL"
  warn "仅用于本地测试；它模拟标准 OAuth/OIDC，不是企业微信协议"
}

run_oauth_mock_test() {
  local url temp_dir authorize_page scan_page callback_headers transaction_id
  local callback_location code token_json access_token userinfo
  run_oauth_mock
  url="$(oauth_mock_url)"
  temp_dir="$(mktemp -d)"
  authorize_page="$temp_dir/authorize.html"
  scan_page="$temp_dir/scan.html"
  callback_headers="$temp_dir/callback.headers"

  curl -fsS "$url/.well-known/openid-configuration" | \
    grep -q '"authorization_endpoint"' || die "OIDC Discovery 验证失败"

  curl -fsS -G -o "$authorize_page" "$url/api/v1/authorize" \
    --data-urlencode 'client_id=casdoor-mock-client' \
    --data-urlencode 'redirect_uri=http://127.0.0.1:8001/callback' \
    --data-urlencode 'response_type=code' \
    --data-urlencode 'scope=openid profile email' \
    --data-urlencode 'state=oauth-mock-test'
  transaction_id="$(sed -nE 's/.*data-transaction="([^"]+)".*/\1/p' "$authorize_page")"
  [[ -n "$transaction_id" ]] || die "扫码授权页缺少 transaction ID"
  curl -fsS -o "$temp_dir/qr.png" "$url/qr/$transaction_id"
  LC_ALL=C grep -q $'\x89PNG' "$temp_dir/qr.png" || die "二维码 PNG 生成失败"

  curl -fsS -o "$scan_page" "$url/scan/$transaction_id"
  grep -q '确认登录 Casdoor' "$scan_page" || die "手机扫码确认页验证失败"
  curl -fsS "$url/api/scan/status?id=$transaction_id" | grep -q '"status":"scanned"' || \
    die "扫码状态未变为 scanned"
  curl -fsS -o /dev/null -X POST "$url/scan/$transaction_id/approve"
  curl -fsS "$url/api/scan/status?id=$transaction_id" | grep -q '"status":"approved"' || \
    die "扫码状态未变为 approved"

  curl -sS -D "$callback_headers" -o /dev/null "$url/api/scan/complete?id=$transaction_id"
  callback_location="$(awk 'tolower($1) == "location:" {sub(/\r$/, ""); print $2}' "$callback_headers")"
  [[ "$callback_location" == http://127.0.0.1:8001/callback\?code=*\&state=oauth-mock-test ]] || \
    die "扫码授权回调参数验证失败：$callback_location"
  code="${callback_location#*code=}"
  code="${code%%&*}"

  token_json="$(curl -fsS -u 'casdoor-mock-client:casdoor-mock-secret' \
    -X POST "$url/api/v1/token" \
    --data-urlencode 'grant_type=authorization_code' \
    --data-urlencode "code=$code" \
    --data-urlencode 'redirect_uri=http://127.0.0.1:8001/callback')"
  access_token="$(printf '%s' "$token_json" | \
    sed -nE 's/.*"access_token"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  [[ -n "$access_token" ]] || die "Token 响应缺少 access_token"

  userinfo="$(curl -fsS -H "Authorization: Bearer $access_token" \
    "$url/api/v1/userinfo")"
  printf '%s' "$userinfo" | grep -q '"sub":"alice@mock.wecom.local"' || \
    die "UserInfo 缺少预期 sub"
  printf '%s' "$userinfo" | grep -q '"email":"alice@mock.wecom.local"' || \
    die "UserInfo 缺少预期 email"
  printf '%s' "$userinfo" | grep -q '"name":"alice"' || \
    die "UserInfo 缺少预期 name"

  find "$temp_dir" -depth -delete
  info "二维码、手机确认、OAuth 回调、Token 和 UserInfo 测试通过"
}

whale_auth_url() {
  printf 'http://127.0.0.1:8001'
}

configure_whale_auth() (
  local url temp_dir cookie_file response provider_endpoint application_endpoint
  url="$(whale_auth_url)"
  temp_dir="$(mktemp -d)"
  cookie_file="$temp_dir/cookies"
  trap 'find "$temp_dir" -depth -delete' EXIT

  response="$(curl --noproxy '*' -fsS -c "$cookie_file" -H 'Content-Type: application/json' \
    -d "{\"application\":\"app-built-in\",\"organization\":\"built-in\",\"username\":\"admin\",\"password\":\"${CASDOOR_DEMO_ADMIN_PASSWORD:-123}\",\"autoSignin\":true,\"type\":\"login\",\"signinMethod\":\"Password\"}" \
    "$url/api/login")"
  printf '%s' "$response" | grep -q '"status": "ok"' || die "无法登录 Casdoor 管理 API"

  response="$(curl --noproxy '*' -fsS -b "$cookie_file" \
    "$url/api/get-provider?id=admin/provider_oauth_mock")"
  if [[ "$response" == *'"name": "provider_oauth_mock"'* ]]; then
    provider_endpoint="$url/api/update-provider?id=admin/provider_oauth_mock"
  else
    provider_endpoint="$url/api/add-provider"
  fi
  response="$(curl --noproxy '*' -fsS -b "$cookie_file" -H 'Content-Type: application/json' \
    -X POST "$provider_endpoint" --data-binary \
    '{"owner":"admin","name":"provider_oauth_mock","displayName":"Local OAuth Mock","category":"OAuth","type":"Custom","clientId":"casdoor-mock-client","clientSecret":"casdoor-mock-secret","customAuthUrl":"http://127.0.0.1:9000/api/v1/authorize","customTokenUrl":"http://host.docker.internal:9000/api/v1/token","customUserInfoUrl":"http://host.docker.internal:9000/api/v1/userinfo","scopes":"openid profile email","userMapping":{"id":"sub","username":"name","displayName":"name","email":"email"}}')"
  printf '%s' "$response" | grep -q '"status": "ok"' || die "配置 OAuth Mock Provider 失败"

  response="$(curl --noproxy '*' -fsS -b "$cookie_file" \
    "$url/api/get-organization?id=admin/whale")"
  if [[ "$response" != *'"name": "whale"'* ]]; then
    response="$(curl --noproxy '*' -fsS -b "$cookie_file" -H 'Content-Type: application/json' \
      -X POST "$url/api/add-organization" --data-binary \
      '{"owner":"admin","name":"whale","displayName":"Whale Buddy","websiteUrl":"http://127.0.0.1:8001","passwordType":"plain","defaultApplication":"app-whale"}')"
    printf '%s' "$response" | grep -q '"status": "ok"' || die "配置 Whale Organization 失败"
  fi

  response="$(curl --noproxy '*' -fsS -b "$cookie_file" \
    "$url/api/get-application?id=admin/app-whale")"
  if [[ "$response" == *'"name": "app-whale"'* ]]; then
    application_endpoint="$url/api/update-application?id=admin/app-whale&columns=displayName,organization,clientId,clientSecret,redirectUris,grantTypes,tokenFormat,expireInHours,refreshExpireInHours,enableSigninSession,enableSignUp,signinMethods,providers"
  else
    application_endpoint="$url/api/add-application"
  fi
  response="$(curl --noproxy '*' -fsS -b "$cookie_file" -H 'Content-Type: application/json' \
    -X POST "$application_endpoint" --data-binary \
    '{"owner":"admin","name":"app-whale","displayName":"Whale Buddy","organization":"whale","clientId":"whale-buddy-desktop","clientSecret":"whale-buddy-desktop-secret","redirectUris":["http://127.0.0.1:17891/oauth/callback"],"grantTypes":["authorization_code","refresh_token"],"tokenFormat":"JWT","expireInHours":168,"refreshExpireInHours":720,"enableSigninSession":false,"enableSignUp":true,"signinMethods":[{"name":"Password","displayName":"Password","rule":"All"}],"providers":[{"owner":"admin","name":"provider_oauth_mock","canSignUp":true,"canSignIn":true,"canUnlink":true,"rule":"All"}]}')"
  printf '%s' "$response" | grep -q '"status": "ok"' || die "配置 Whale Application 失败"

  info "Whale OIDC 客户端已配置：http://127.0.0.1:8001/login/oauth/authorize"
)

run_whale_auth_check() {
  local url application discovery
  url="$(whale_auth_url)"
  wait_for_http "$url" 10 || die "Casdoor 未运行"
  wait_for_oauth_mock || die "OAuth Mock 未运行"
  application="$(curl --noproxy '*' -fsS -G "$url/api/get-app-login" \
    --data-urlencode 'clientId=whale-buddy-desktop' \
    --data-urlencode 'responseType=code' \
    --data-urlencode 'redirectUri=http://127.0.0.1:17891/oauth/callback' \
    --data-urlencode 'type=code' \
    --data-urlencode 'scope=openid profile email offline_access' \
    --data-urlencode 'state=whale-auth-check' \
    --data-urlencode 'code_challenge_method=S256' \
    --data-urlencode 'code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')"
  [[ "$application" == *'"status": "ok"'* ]] || die "Casdoor 拒绝 Whale OAuth 参数或固定回调"
  [[ "$application" == *'"name": "app-whale"'* ]] || die "Casdoor 未返回 app-whale"
  [[ "$application" == *'"organization": "whale"'* ]] || die "Whale Application 未使用专用 Organization"
  [[ "$application" == *'"clientId": "whale-buddy-desktop"'* ]] || die "Whale client_id 不匹配"
  [[ "$application" == *'"enableSignUp": true'* ]] || die "Whale Application 未允许首次登录创建用户"
  [[ "$application" == *'"name": "provider_oauth_mock"'* ]] || die "Whale Application 未启用 OAuth Mock"
  discovery="$(curl --noproxy '*' -fsS "$url/.well-known/openid-configuration")"
  [[ "$discovery" == *'"S256"'* ]] || die "Casdoor 未声明 PKCE S256"
  info "Whale OIDC 客户端、固定回调、PKCE 和 OAuth Mock 检查通过"
}

run_whale_auth_demo() {
  load_optional_env
  [[ "${CASDOOR_DEMO_PORT:-8001}" == "8001" ]] || die "Whale 本地联调固定使用 Casdoor 端口 8001"
  [[ "${OAUTH_MOCK_PORT:-9000}" == "9000" ]] || die "Whale 本地联调固定使用 OAuth Mock 端口 9000"
  run_demo
  run_oauth_mock
  configure_whale_auth
  run_whale_auth_check
  info "Whale 登录联调环境已就绪"
}

run_backup() {
  parse_registry_options "$@"
  ((${#REGISTRY_POSITIONAL_ARGS[@]} == 0)) || \
    die "backup 不支持参数：${REGISTRY_POSITIONAL_ARGS[*]}"
  require_docker
  load_env "$ENV_FILE"
  validate_prod_env
  apply_registry_prefix "$REGISTRY_OPTION_PREFIX"
  wait_for_mysql
  backup_database production
}

run_restore() {
  parse_registry_options "$@"
  ((${#REGISTRY_POSITIONAL_ARGS[@]} == 1)) || \
    die "用法：./deploy.sh restore <database.sql.gz> [--registry-prefix HOST]"
  require_docker
  load_env "$ENV_FILE"
  validate_prod_env
  apply_registry_prefix "$REGISTRY_OPTION_PREFIX"
  wait_for_mysql
  restore_database "${REGISTRY_POSITIONAL_ARGS[0]}" production
  wait_for_http "$(prod_url)" "${CASDOOR_START_TIMEOUT:-120}" || \
    die "恢复后健康检查失败"
}

run_update() {
  parse_registry_options "$@"
  ((${#REGISTRY_POSITIONAL_ARGS[@]} <= 1)) || \
    die "用法：./deploy.sh update [version] [--registry-prefix HOST]"
  local new_version="${REGISTRY_POSITIONAL_ARGS[0]:-}"
  if [[ -n "$new_version" ]]; then
    [[ "$new_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本格式应为 x.y.z"
  fi

  require_docker
  load_env "$ENV_FILE"
  validate_prod_env
  local registry_prefix="${REGISTRY_OPTION_PREFIX:-${REGISTRY_PREFIX:-}}"
  apply_registry_prefix "$registry_prefix"
  wait_for_mysql
  backup_database production
  if [[ -n "$new_version" ]]; then
    replace_version "$new_version"
    load_env "$ENV_FILE"
    validate_prod_env
    apply_registry_prefix "$registry_prefix"
  fi
  prod_compose pull casdoor
  prod_compose up -d casdoor
  wait_for_http "$(prod_url)" "${CASDOOR_START_TIMEOUT:-120}" || \
    die "更新后健康检查失败"
}

test_cleanup() {
  test_compose down -v --remove-orphans >/dev/null 2>&1 || true
}

run_test_inner() {
  require_docker
  bundle_check
  load_env "$TEST_ENV_FILE"
  validate_common_env
  require_var CASDOOR_TEST_PORT
  test_compose config --quiet
  test_cleanup
  test_compose pull
  test_compose up -d db
  MYSQL_CLIENT_NETWORK="${TEST_PROJECT}_default"
  wait_for_mysql
  bootstrap_database
  test_compose up -d casdoor

  local url="http://127.0.0.1:$CASDOOR_TEST_PORT"
  if ! wait_for_http "$url" "${CASDOOR_START_TIMEOUT:-120}"; then
    test_compose logs --no-color > "$SCRIPT_DIR/test-failure.log" 2>&1 || true
    die "测试 Casdoor 未通过健康检查；日志：$SCRIPT_DIR/test-failure.log"
  fi
  local container_image
  container_image="$(docker inspect --format '{{.Config.Image}}' "$(test_compose ps -q casdoor)")"
  [[ "$container_image" == "casbin/casdoor:$CASDOOR_VERSION" ]] || \
    die "运行镜像与固定版本不一致：$container_image"
  curl -fsS "$url/.well-known/openid-configuration" | grep -q 'authorization_endpoint' || \
    die "OIDC Discovery 验证失败"
  curl -fsS "$url/" >/dev/null || die "登录页无法访问"

  test_compose restart casdoor >/dev/null
  wait_for_http "$url" "${CASDOOR_START_TIMEOUT:-120}" || die "容器重启后健康检查失败"
  backup_database test
  CASDOOR_ASSUME_YES=1 restore_database "$LAST_BACKUP_FILE" test
  wait_for_http "$url" "${CASDOOR_START_TIMEOUT:-120}" || die "恢复后健康检查失败"
  test_cleanup
  info "内部 Docker 端到端测试通过"
}

copy_test_bundle() {
  local destination="$1"
  mkdir -p "$destination"
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env.test" "$SCRIPT_DIR/.gitignore" \
    "$SCRIPT_DIR/README.md" "$SCRIPT_DIR/compose.yaml" "$SCRIPT_DIR/compose.demo.yaml" \
    "$SCRIPT_DIR/compose.oauth-mock.yaml" "$SCRIPT_DIR/compose.test.yaml" \
    "$SCRIPT_DIR/oauth-mock-linux-amd64" "$SCRIPT_DIR/oauth-mock-linux-arm64" \
    "$SCRIPT_DIR/deploy.sh" "$destination/"
}

run_test() {
  require_command mktemp
  bundle_check
  local stage_root stage
  stage_root="$(mktemp -d)"
  stage="$stage_root/casdoor"
  copy_test_bundle "$stage"
  info "仅使用隔离部署包进行测试：$stage"

  if WHALE_CASDOOR_STAGED_TEST=1 "$stage/deploy.sh" _test-run; then
    find "$stage_root" -depth -delete
  else
    warn "测试失败；隔离目录和测试容器已保留：$stage"
    warn "检查后运行：cd '$stage' && ./deploy.sh test-clean"
    return 1
  fi
}

main() {
  local command="${1:-help}"
  case "$command" in
    help|-h|--help) usage ;;
    init)
      [[ ! -e "$ENV_FILE" ]] || die ".env 已存在，不会覆盖"
      cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
      chmod 600 "$ENV_FILE"
      info "已创建 ${ENV_FILE}；请编辑后运行 ./deploy.sh doctor"
      ;;
    bundle-check) bundle_check ;;
    doctor)
      shift
      parse_registry_options "$@"
      ((${#REGISTRY_POSITIONAL_ARGS[@]} == 0)) || \
        die "doctor 不支持参数：${REGISTRY_POSITIONAL_ARGS[*]}"
      run_doctor "$REGISTRY_OPTION_PREFIX"
      ;;
    deploy) shift; run_deploy "$@" ;;
    demo) shift; run_demo "$@" ;;
    demo-stop) require_docker; demo_compose down --remove-orphans ;;
    demo-logs) require_docker; demo_compose logs -f casdoor-demo ;;
    oauth-mock) run_oauth_mock ;;
    oauth-mock-status) require_docker; load_optional_env; oauth_mock_compose ps ;;
    oauth-mock-logs) require_docker; load_optional_env; oauth_mock_compose logs -f oauth-mock ;;
    oauth-mock-test) run_oauth_mock_test ;;
    oauth-mock-stop) require_docker; load_optional_env; oauth_mock_compose down --remove-orphans ;;
    whale-auth-demo) run_whale_auth_demo ;;
    whale-auth-check) run_whale_auth_check ;;
    status) require_docker; load_env "$ENV_FILE"; validate_prod_env; prod_compose ps ;;
    logs) require_docker; load_env "$ENV_FILE"; validate_prod_env; prod_compose logs -f casdoor ;;
    restart)
      require_docker; load_env "$ENV_FILE"; validate_prod_env
      prod_compose restart casdoor
      wait_for_http "$(prod_url)" "${CASDOOR_START_TIMEOUT:-120}" || die "重启后健康检查失败"
      ;;
    stop) require_docker; load_env "$ENV_FILE"; validate_prod_env; prod_compose stop casdoor ;;
    backup) shift; run_backup "$@" ;;
    restore) shift; run_restore "$@" ;;
    update) shift; run_update "$@" ;;
    uninstall)
      require_docker; load_env "$ENV_FILE"; validate_prod_env
      prod_compose down --remove-orphans
      info "已删除正式容器和网络；外部 MySQL、备份和日志卷均保留"
      ;;
    test) run_test ;;
    _test-run)
      [[ "${WHALE_CASDOOR_STAGED_TEST:-0}" == "1" ]] || die "内部测试命令不能直接调用"
      run_test_inner
      ;;
    test-clean) require_docker; test_cleanup; info "测试环境已清理" ;;
    *) usage; die "未知命令：$command" ;;
  esac
}

main "$@"
