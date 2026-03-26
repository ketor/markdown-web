const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const basicAuth = require('express-basic-auth');
const { marked } = require('marked');
const { JSDOM } = require('jsdom');
const DOMPurify = require('dompurify');

// ============================================================
// 加载配置：config.json < 环境变量覆盖
// ============================================================
const configPath = path.join(__dirname, 'config.json');
let fileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`Loaded config from ${configPath}`);
} catch (error) {
  console.warn(`Warning: could not load config.json (${error.message}), using defaults`);
}

const config = {
  port:       parseInt(process.env.PORT, 10)       || fileConfig.port       || 8081,
  basePath:   process.env.BASE_PATH !== undefined   ? process.env.BASE_PATH : (fileConfig.basePath ?? ''),
  reportsDir: process.env.REPORTS_DIR              || fileConfig.reportsDir || path.join(__dirname, '..', '..', 'reports'),
  title:      fileConfig.title                     || 'Report Web Service',
  auth: {
    enabled:  fileConfig.auth?.enabled  ?? false,
    username: fileConfig.auth?.username || '',
    password: fileConfig.auth?.password || '',
  },
  https: {
    enabled:      fileConfig.https?.enabled      ?? true,
    certDir:      fileConfig.https?.certDir       || './cert',
    httpRedirect: fileConfig.https?.httpRedirect  ?? true,
  },
};

// 将相对 certDir 解析为绝对路径
if (!path.isAbsolute(config.https.certDir)) {
  config.https.certDir = path.join(__dirname, config.https.certDir);
}

console.log('Effective config:', JSON.stringify({
  port: config.port,
  basePath: config.basePath,
  reportsDir: config.reportsDir,
  title: config.title,
  authEnabled: config.auth.enabled,
  httpsEnabled: config.https.enabled,
}, null, 2));

// ============================================================
// Express 应用
// ============================================================
const app = express();

// 创建 DOM 用于 DOMPurify
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// 配置 marked
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: true,
  mangle: false
});

// Basic Auth（仅在启用时）
if (config.auth.enabled) {
  if (!config.auth.username || !config.auth.password) {
    console.error('Auth is enabled but username/password not configured. Check config.json');
    process.exit(1);
  }
  app.use(basicAuth({
    users: { [config.auth.username]: config.auth.password },
    challenge: true,
    realm: config.title,
    unauthorizedResponse: () => 'Unauthorized - Invalid credentials'
  }));
  console.log(`Basic auth enabled for user: ${config.auth.username}`);
} else {
  console.log('Basic auth disabled');
}

// 静态文件服务
app.use('/static', express.static(path.join(__dirname, 'public')));

// ============================================================
// 路由
// ============================================================
app.get('*', async (req, res) => {
  let requestPath = decodeURIComponent(req.path);
  // 去掉 BASE_PATH 前缀
  if (config.basePath && requestPath.startsWith(config.basePath)) {
    requestPath = requestPath.slice(config.basePath.length) || '/';
  }
  const fullPath = path.join(config.reportsDir, requestPath);

  // 安全检查：确保不访问 reports 目录之外的文件
  if (!fullPath.startsWith(config.reportsDir)) {
    return res.status(403).send('Access denied');
  }

  // 检查文件/目录是否存在
  if (!fs.existsSync(fullPath)) {
    return res.status(404).send('Not found');
  }

  const stat = fs.statSync(fullPath);

  if (stat.isDirectory()) {
    renderDirectory(fullPath, requestPath, res);
  } else {
    const ext = path.extname(fullPath).toLowerCase();

    if (req.query.download === '1') {
      return res.download(fullPath, path.basename(fullPath));
    }

    if (ext === '.md') {
      await renderMarkdown(fullPath, requestPath, res);
    } else {
      res.sendFile(fullPath);
    }
  }
});

// ============================================================
// 渲染：目录列表
// ============================================================
function renderDirectory(fullPath, requestPath, res) {
  const files = fs.readdirSync(fullPath);
  const items = files.map(file => {
    const filePath = path.join(fullPath, file);
    try {
      const stat = fs.statSync(filePath);
      return {
        name: file,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtime: stat.mtime
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  const bp = config.basePath;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Index of ${requestPath || '/'}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #333;
      border-bottom: 2px solid #ddd;
      padding-bottom: 10px;
    }
    .breadcrumb {
      margin-bottom: 20px;
      color: #666;
    }
    .breadcrumb a {
      color: #0066cc;
      text-decoration: none;
    }
    .file-list {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .file-item {
      display: flex;
      align-items: center;
      padding: 12px 20px;
      border-bottom: 1px solid #eee;
      transition: background 0.2s;
    }
    .file-item:hover {
      background: #f8f9fa;
    }
    .file-item:last-child {
      border-bottom: none;
    }
    .icon {
      width: 24px;
      margin-right: 12px;
      text-align: center;
    }
    .name {
      flex: 1;
    }
    .name a {
      color: #0066cc;
      text-decoration: none;
    }
    .name a:hover {
      text-decoration: underline;
    }
    .size {
      color: #666;
      font-size: 14px;
      width: 100px;
      text-align: right;
    }
    .mtime {
      color: #999;
      font-size: 14px;
      width: 180px;
      text-align: right;
    }
    .parent {
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>Index of ${requestPath || '/'}</h1>
  <div class="breadcrumb">
    ${generateBreadcrumb(requestPath)}
  </div>
  <div class="file-list">
    ${requestPath ? `
    <div class="file-item parent">
      <span class="icon">📁</span>
      <span class="name"><a href="${bp}${path.join(requestPath, '..')}">../</a></span>
    </div>
    ` : ''}
    ${items.map(item => `
    <div class="file-item">
      <span class="icon">${item.isDirectory ? '📁' : getFileIcon(item.name)}</span>
      <span class="name"><a href="${bp}${path.join(requestPath, item.name)}">${item.name}${item.isDirectory ? '/' : ''}</a></span>
      <span class="size">${item.isDirectory ? '-' : formatSize(item.size)}</span>
      <span class="mtime">${item.mtime.toLocaleString()}</span>
    </div>
    `).join('')}
  </div>
</body>
</html>
  `;

  res.send(html);
}

// ============================================================
// 渲染：数学公式辅助
// ============================================================
function extractMath(text) {
  const mathBlocks = [];
  let index = 0;

  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
    const placeholder = `%%MATH_BLOCK_${index}%%`;
    mathBlocks.push({ placeholder, formula: formula.trim(), display: true });
    index++;
    return placeholder;
  });

  text = text.replace(/(?<![\\$])\$(?!\$)(.+?)(?<![\\$])\$/g, (match, formula) => {
    const placeholder = `%%MATH_INLINE_${index}%%`;
    mathBlocks.push({ placeholder, formula: formula.trim(), display: false });
    index++;
    return placeholder;
  });

  return { text, mathBlocks };
}

function restoreMath(html, mathBlocks) {
  for (const { placeholder, formula, display } of mathBlocks) {
    const escaped = formula
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    if (display) {
      html = html.replace(placeholder, `<div class="math-display" data-math="${escaped}"></div>`);
    } else {
      html = html.replace(placeholder, `<span class="math-inline" data-math="${escaped}"></span>`);
    }
  }
  return html;
}

// ============================================================
// 渲染：Markdown 文件
// ============================================================
async function renderMarkdown(fullPath, requestPath, res) {
  let content = fs.readFileSync(fullPath, 'utf-8');

  const hasMermaid = content.includes('```mermaid');
  const hasMath = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(content);

  let mathBlocks = [];
  if (hasMath) {
    const extracted = extractMath(content);
    content = extracted.text;
    mathBlocks = extracted.mathBlocks;
  }

  let htmlContent = marked(content);

  htmlContent = purify.sanitize(htmlContent, {
    ADD_ATTR: ['data-math'],
    ADD_TAGS: []
  });

  if (hasMath) {
    htmlContent = restoreMath(htmlContent, mathBlocks);
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${path.basename(fullPath)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 40px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 2px solid #eee;
    }
    .back-link {
      color: #0066cc;
      text-decoration: none;
    }
    .back-link:hover {
      text-decoration: underline;
    }
    .mermaid-toggle {
      background: #0066cc;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .mermaid-toggle:hover {
      background: #0052a3;
    }
    .download-btn {
      background: #28a745;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-right: 10px;
    }
    .download-btn:hover {
      background: #218838;
    }
    .header-buttons {
      display: flex;
      align-items: center;
    }

    /* Markdown 样式 */
    .markdown-body h1 { color: #333; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
    .markdown-body h2 { color: #444; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-top: 30px; }
    .markdown-body h3 { color: #555; margin-top: 24px; }
    .markdown-body p { line-height: 1.6; color: #333; }
    .markdown-body code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
    }
    .markdown-body pre {
      background: #f8f8f8;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    .markdown-body pre code {
      background: none;
      padding: 0;
    }
    .markdown-body blockquote {
      border-left: 4px solid #ddd;
      margin: 0;
      padding-left: 16px;
      color: #666;
    }
    .markdown-body ul, .markdown-body ol {
      padding-left: 24px;
    }
    .markdown-body li {
      margin: 8px 0;
    }
    .markdown-body table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid #ddd;
      padding: 12px;
      text-align: left;
    }
    .markdown-body th {
      background: #f5f5f5;
    }

    /* 数学公式样式 */
    .math-display {
      text-align: center;
      padding: 12px 0;
      margin: 16px 0;
      overflow-x: auto;
    }
    .math-inline {
      display: inline;
    }
    .math-error {
      color: #cc0000;
      font-family: monospace;
      font-size: 0.9em;
    }

    /* Mermaid 图表样式 */
    .mermaid {
      text-align: center;
      padding: 20px;
      background: #fafafa;
      border-radius: 6px;
      margin: 16px 0;
    }
    .mermaid-code {
      display: none;
      background: #f8f8f8;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    .mermaid-code pre {
      margin: 0;
    }
    .mermaid-container.view-code .mermaid { display: none; }
    .mermaid-container.view-code .mermaid-code { display: block; }
    .mermaid-controls {
      text-align: right;
      margin-bottom: 8px;
    }
    .mermaid-controls button {
      background: #666;
      color: white;
      border: none;
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-left: 8px;
    }
    .mermaid-controls button:hover {
      background: #555;
    }
  </style>
  ${hasMath ? `
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  ` : ''}
  ${hasMermaid ? '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>' : ''}
</head>
<body>
  <div class="container">
    <div class="header">
      <a href="${config.basePath}${path.dirname(requestPath)}" class="back-link">← 返回目录</a>
      <div class="header-buttons">
        <a href="${config.basePath}${requestPath}?download=1" class="download-btn">
          <span>⬇️</span> 下载 Markdown
        </a>
        ${hasMermaid ? '<button class="mermaid-toggle" onclick="toggleAllMermaid()">切换所有 Mermaid 视图</button>' : ''}
      </div>
    </div>
    <div class="markdown-body">
      ${htmlContent}
    </div>
  </div>

  <script>
    ${hasMath ? `
    document.querySelectorAll('.math-display, .math-inline').forEach(el => {
      const formula = el.getAttribute('data-math');
      const displayMode = el.classList.contains('math-display');
      try {
        katex.render(formula, el, {
          displayMode: displayMode,
          throwOnError: false,
          trust: true
        });
      } catch (e) {
        el.innerHTML = '<span class="math-error">' + e.message + '</span>';
      }
    });
    ` : ''}
    ${hasMermaid ? `
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'strict'
    });

    document.querySelectorAll('pre code.language-mermaid').forEach((block, index) => {
      const container = document.createElement('div');
      container.className = 'mermaid-container';
      container.id = 'mermaid-' + index;

      const controls = document.createElement('div');
      controls.className = 'mermaid-controls';
      controls.innerHTML = '<button onclick="toggleMermaid(' + index + ')">切换视图</button>';

      const diagramDiv = document.createElement('div');
      diagramDiv.className = 'mermaid';
      diagramDiv.textContent = block.textContent;

      const codeDiv = document.createElement('div');
      codeDiv.className = 'mermaid-code';
      codeDiv.innerHTML = '<pre><code class="language-mermaid">' + escapeHtml(block.textContent) + '</code></pre>';

      container.appendChild(controls);
      container.appendChild(diagramDiv);
      container.appendChild(codeDiv);

      block.parentElement.replaceWith(container);
    });

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function toggleMermaid(index) {
      const container = document.getElementById('mermaid-' + index);
      container.classList.toggle('view-code');
    }

    function toggleAllMermaid() {
      document.querySelectorAll('.mermaid-container').forEach((container, index) => {
        toggleMermaid(index);
      });
    }
    ` : ''}
  </script>
</body>
</html>
  `;

  res.send(html);
}

// ============================================================
// 工具函数
// ============================================================
function generateBreadcrumb(requestPath) {
  if (!requestPath) return `<a href="${config.basePath}/">/</a>`;

  const parts = requestPath.split('/').filter(Boolean);
  let result = `<a href="${config.basePath}/">/</a>`;
  let currentPath = '';

  parts.forEach((part, index) => {
    currentPath += '/' + part;
    if (index === parts.length - 1) {
      result += ` / ${part}`;
    } else {
      result += ` / <a href="${config.basePath}${currentPath}">${part}</a>`;
    }
  });

  return result;
}

function getFileIcon(filename) {
  const ext = path.extname(filename).toLowerCase();
  const icons = {
    '.md': '📝', '.txt': '📄', '.json': '📋', '.js': '📜',
    '.ts': '📘', '.py': '🐍', '.go': '🐹', '.java': '☕',
    '.html': '🌐', '.css': '🎨', '.yml': '⚙️', '.yaml': '⚙️',
    '.xml': '📰', '.sh': '🔧', '.zip': '📦', '.tar': '📦', '.gz': '📦'
  };
  return icons[ext] || '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// ============================================================
// 启动服务器
// ============================================================
const certDir = config.https.certDir;
const keyPath = path.join(certDir, 'key.pem');
const certFilePath = path.join(certDir, 'cert.pem');

if (config.https.enabled) {
  // 确保证书目录存在
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  // 自动生成自签名证书
  if (!fs.existsSync(keyPath) || !fs.existsSync(certFilePath)) {
    console.log('Generating self-signed certificate...');
    const { execSync } = require('child_process');
    try {
      execSync(`openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certFilePath}" -days 365 -nodes -subj "/CN=localhost"`, {
        stdio: 'inherit'
      });
      console.log('Certificate generated successfully!');
    } catch (error) {
      console.error('Failed to generate certificate:', error.message);
      process.exit(1);
    }
  }

  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certFilePath)
  };

  https.createServer(httpsOptions, app).listen(config.port, '0.0.0.0', () => {
    console.log(`HTTPS Server running on https://0.0.0.0:${config.port}`);
    console.log(`Reports directory: ${config.reportsDir}`);
  });

  // HTTP → HTTPS 跳转
  if (config.https.httpRedirect) {
    http.createServer((req, res) => {
      res.writeHead(301, { Location: `https://${req.headers.host}:${config.port}${req.url}` });
      res.end();
    }).listen(config.port + 1, '0.0.0.0', () => {
      console.log(`HTTP redirect server running on http://0.0.0.0:${config.port + 1}`);
    });
  }
} else {
  // 纯 HTTP 模式
  http.createServer(app).listen(config.port, '0.0.0.0', () => {
    console.log(`HTTP Server running on http://0.0.0.0:${config.port}`);
    console.log(`Reports directory: ${config.reportsDir}`);
  });
}
