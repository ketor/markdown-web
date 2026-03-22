# Markdown Web

基于 Express 的 Web 文件浏览器，专注于 Markdown 报告的在线浏览与渲染。

## 功能特性

- Markdown 渲染（基于 marked，支持 GFM）
- KaTeX 数学公式渲染（`$...$` 行内，`$$...$$` 块级）
- Mermaid 图表渲染（支持图表/代码视图切换）
- 目录浏览与面包屑导航
- HTTPS 支持（自动生成自签名证书）
- HTTP → HTTPS 自动跳转
- 可选的 Basic Auth 认证
- DOMPurify HTML 净化防 XSS
- 所有配置集中在 `config.json`

## 快速开始

```bash
# 安装依赖
npm install

# 复制并编辑配置
cp config.example.json config.json
# 编辑 config.json 设置 reportsDir 等

# 启动
npm start
```

服务默认监听：
- HTTPS: `https://localhost:8081`
- HTTP 跳转: `http://localhost:8082`

## 配置

所有配置通过项目根目录的 `config.json` 管理。首次使用请从 `config.example.json` 复制：

```json
{
  "port": 8081,
  "basePath": "",
  "reportsDir": "./reports",
  "title": "Report Web Service",
  "auth": {
    "enabled": false,
    "username": "",
    "password": ""
  },
  "https": {
    "enabled": true,
    "certDir": "./cert",
    "httpRedirect": true
  }
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `port` | 监听端口 | `8081` |
| `basePath` | URL 前缀，用于反向代理场景（如 `/reports`） | `""` |
| `reportsDir` | 报告文件根目录（绝对或相对路径） | `../../reports` |
| `title` | 页面标题 / Basic Auth realm | `Report Web Service` |
| `auth.enabled` | 是否启用 Basic Auth | `false` |
| `auth.username` | 认证用户名 | — |
| `auth.password` | 认证密码 | — |
| `https.enabled` | 启用 HTTPS（`false` 则纯 HTTP） | `true` |
| `https.certDir` | 证书目录（含 `key.pem`、`cert.pem`） | `./cert` |
| `https.httpRedirect` | 是否启动 HTTP→HTTPS 跳转服务 | `true` |

环境变量 `PORT`、`BASE_PATH`、`REPORTS_DIR` 可覆盖对应配置项。

## 服务管理

项目提供 `service.sh` 脚本用于守护进程管理：

```bash
./service.sh start     # 启动
./service.sh stop      # 停止
./service.sh restart   # 重启
./service.sh status    # 查看状态
./service.sh monitor   # 守护模式（每 30s 检查，崩溃自动重启）
```

## 反向代理

Nginx 配置示例（将 `/reports/` 代理到本服务）：

```nginx
location /reports/ {
    proxy_pass https://127.0.0.1:8081/;
    proxy_ssl_verify off;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

此场景下 `config.json` 中 `basePath` 应设为 `"/reports"`。

## 数学公式

Markdown 中使用 LaTeX 语法：

- 行内公式：`$E = mc^2$`
- 块级公式：
  ```
  $$
  \text{KV\_Cache\_Size} = 2 \times L \times h_{kv} \times d_h \times s \times \text{dtype\_bytes}
  $$
  ```

仅在页面包含公式时加载 KaTeX CDN 资源。

## Mermaid 图表

在 Markdown 中使用 ` ```mermaid ` 代码块，渲染后支持图表/代码视图切换。

## 证书

首次启动时自动在 `certDir` 目录下生成自签名证书。也可手动生成：

```bash
npm run gen-cert
```

或替换为正式证书（将 `key.pem` 和 `cert.pem` 放入证书目录）。

## License

MIT
