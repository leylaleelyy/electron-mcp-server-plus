## 环境与前提
- Node 版本：建议 `>=20.0.0`（项目要求 `>=18.0.0`，更高版本更稳定）
- Electron 启用远程调试端口：在主进程最早位置添加 `app.commandLine.appendSwitch('remote-debugging-port','9222')`，或通过启动参数 `electron . --remote-debugging-port=9222`
- 启动 MCP 服务器：
  - 开发：在项目根目录运行 `npm run dev`（使用 stdio 传输，入口 `src/index.ts:85`）
  - 生产：`npm run build` 后 `npm start`（入口 `dist/index.js`）

## MCP 客户端配置
- 本地配置示例（以 VS Code/Claude/Cursor 为例，命令行方式相同）：
```
{
  "mcpServers": {
    "electron-mcp": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": { "SCREENSHOT_ENCRYPTION_KEY": "default-screenshot-key-change-me" }
    }
  }
}
```
- 开发环境（不构建）：
```
{
  "mcpServers": {
    "electron-mcp": {
      "command": "npm",
      "args": ["run", "dev"],
      "env": { "SCREENSHOT_ENCRYPTION_KEY": "default-screenshot-key-change-me" }
    }
  }
}
```
- Windows 注意：确保目标 Electron 以 `--remote-debugging-port` 运行；若需要保存截图，请使用项目子目录路径，如 `d:\projects\electron-mcp-server-plus\artifacts\perf.png`

## 可用工具与参数速览
- `get_electron_window_info`（`src/tools.ts:25`）
  - 入参：`includeChildren?: boolean`
  - 用途：列出可用窗口目标（排除 DevTools）
- `take_screenshot`（`src/tools.ts:31`）
  - 入参：`outputPath?: string`, `windowTitle?: string`
  - 用途：返回 PNG base64；可选保存至磁盘（并生成加密备份）
- `send_command_to_electron`（`src/tools.ts:43`）
  - 入参：`command: string`, `args?: { selector?, text?, value?, placeholder?, code? }`
  - 用途：页面交互与信息采集（点击、填表、快捷键、哈希导航、结构/调试、eval 等）
- `read_electron_logs`（`src/tools.ts:74`）
  - 入参：`logType?: 'console'|'main'|'renderer'|'all'`, `lines?: number`, `follow?: boolean`
  - 用途：读取控制台或系统日志（优先 DevTools 通道）
- `run_performance_snapshot`（`src/tools.ts:37`）
  - 入参：`includeResources?`, `includeNavigation?`, `collectConsoleErrors?`, `captureScreenshot?`, `outputPath?`, `windowTitle?`, `metricsOnly?`, `includeWebVitals?`
  - 用途：采集 `performance.timing/entries/paint`、可选 Web Vitals、错误日志与截图
- `run_devtools_trace`（`src/tools.ts:53`）
  - 入参：`durationMs?`, `categories?: string[]`
  - 用途：录制短时 DevTools Trace，输出长任务与高占用分类摘要
- `capture_network_snapshot`（`src/tools.ts:100`）
  - 入参：`durationMs?`, `idleMs?`, `maxRequests?`, `includeFailures?`
  - 用途：订阅 Network 事件，统计慢请求与错误；空闲或超时结束
- `run_automation_script`（`src/tools.ts:80`）
  - 入参：`steps: {command, args}[]`, `preScreenshot?`, `postScreenshot?`, `outputPath?`, `windowTitle?`, `includeLogs?`, `logLines?`, `usePlaywright?`
  - 用途：按步骤执行自动化；`usePlaywright: true` 时使用稳定的 Playwright 驱动（实现于 `src/utils/electron-enhanced-commands.ts:698`）

## 典型场景与提示词
### 页面性能诊断
- “采集性能快照（含资源/导航/Web Vitals 与最近 200 行错误），并保存截图到 artifacts”
  - 对应工具：`run_performance_snapshot`
  - 参数示例：`{"includeResources":true,"includeNavigation":true,"collectConsoleErrors":true,"captureScreenshot":true,"includeWebVitals":true,"outputPath":"d:\\projects\\electron-mcp-server-plus\\artifacts\\perf.png"}`
- “录 6 秒 Trace，输出长任务 Top10 和分类 Top10”
  - 对应工具：`run_devtools_trace`
  - 参数示例：`{"durationMs":6000,"categories":["devtools.timeline","disabled-by-default-v8.cpu_profiler"]}`
- “抓 5 秒网络活动，列出最慢的 10 个请求与所有失败请求（空闲阈值 800ms）”
  - 对应工具：`capture_network_snapshot`
  - 参数示例：`{"durationMs":5000,"idleMs":800,"maxRequests":500,"includeFailures":true}`

### 稳态自动化（Playwright 驱动）
- “进入 `#create`，等待按钮出现后点击‘新建’，填写标题与说明，选择国家为 CN，按 Enter，等待网络空闲；前后截图并返回最近 150 行错误日志，用更稳的驱动执行”
  - 对应工具：`run_automation_script`
  - 参数示例：
```
{
  "steps": [
    {"command":"wait_for_url_includes","args":{"text":"#create","value":"5000"}},
    {"command":"wait_for_selector","args":{"selector":"button.new","value":"5000"}},
    {"command":"click_by_text","args":{"text":"新建"}},
    {"command":"fill_input","args":{"placeholder":"标题","value":"测试任务"}},
    {"command":"fill_input","args":{"selector":"#desc","value":"这是说明"}},
    {"command":"select_option","args":{"selector":"select[name='country']","value":"CN"}},
    {"command":"send_keyboard_shortcut","args":{"text":"Enter"}},
    {"command":"wait_for_idle"}
  ],
  "preScreenshot": true,
  "postScreenshot": true,
  "includeLogs": true,
  "logLines": 150,
  "usePlaywright": true
}
```

### 页面信息与元素操作
- “返回当前窗口标题、URL、主体前 500 字” → `send_command_to_electron`：`{"command":"get_title"}`、`{"command":"get_url"}`、`{"command":"get_body_text"}`
- “列出页面结构概览与调试元素 Top10” → `send_command_to_electron`：`{"command":"get_page_structure"}`、`{"command":"debug_elements"}`
- “点击文本为‘提交’的按钮” → `send_command_to_electron`：`{"command":"click_by_text","args":{"text":"提交"}}`
- “用选择器点击 `button.submit`” → `send_command_to_electron`：`{"command":"click_by_selector","args":{"selector":"button.submit"}}`
- “将占位符为‘邮箱’的输入框填为 `test@example.com` 并触发表单校验” → `send_command_to_electron`：`{"command":"fill_input","args":{"placeholder":"邮箱","value":"test@example.com"}}`
- “发送快捷键 Enter / Ctrl+N” → `send_command_to_electron`：`{"command":"send_keyboard_shortcut","args":{"text":"Enter"}}` 或 `{"command":"send_keyboard_shortcut","args":{"text":"Ctrl+N"}}`

### 日志与截图
- “读取最近 200 行控制台日志，仅保留错误与异常” → `read_electron_logs`：`{"logType":"console","lines":200}`
- “截图并保存到 artifacts，同时返回 PNG base64” → `take_screenshot`：`{"outputPath":"d:\\projects\\electron-mcp-server-plus\\artifacts\\after.png"}`

## 故障排查
- 无法发现窗口：确认 Electron 已使用 `--remote-debugging-port=9222` 启动；或检查端口范围扫描（`src/utils/electron-discovery.ts:37`）
- 截图失败/拒绝保存：使用项目子目录路径；避免系统目录（安全校验在 `src/screenshot.ts:51`）
- 自动化不稳定：在步骤中加入 `wait_for_selector`、`wait_for_url_includes`、`wait_for_idle`；必要时开启 `usePlaywright: true`
- Web Vitals 未返回：确保页面有可观测条目；此指标为粗略采集，复杂场景建议结合 Trace 洞察

## 代码参考位置
- 工具注册：`d:\projects\electron-mcp-server-plus\src\tools.ts:23`
- 工具处理：`d:\projects\electron-mcp-server-plus\src\handlers.ts:26`
- DevTools Trace：`d:\projects\electron-mcp-server-plus\src\utils\devtools-tracing.ts:1`
- Network 快照：`d:\projects\electron-mcp-server-plus\src\utils\devtools-network.ts:1`
- 自动化与等待：`d:\projects\electron-mcp-server-plus\src\utils\electron-enhanced-commands.ts:52`、`698`
- 截图：`d:\projects\electron-mcp-server-plus\src\screenshot.ts:150`

---
如确认以上配置与使用说明，我将输出完整的可复制文档版本，并可选生成一个 `artifacts/` 目录的示例脚本参数清单以便开箱即用。