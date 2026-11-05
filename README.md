# 会话统计 · DSH Session Dashboard

[![CI](https://github.com/starriv/dsh-session-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/starriv/dsh-session-dashboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

一个带左侧栏入口的 DeepSeek Harness Web GUI 插件：在本机读取 DSH 会话日志，
展示 Token 用量、费用估算、每日趋势、Token 构成、会话排行与宿主运行状态。

图表为手写 SVG（d3-* 仅提供比例尺与路径计算），主题、明暗模式、移动端布局和
高精度加载骨架都随 Host 的 `--dsw-alias-*` token 工作。设计按
[dashboard-design](https://github.com/abdiraimov-otabek/dashboard-design-skill)
的 dashboard 规范校准：一屏一个问题、KPI 带上期基线、刻意克制的数据配色、
零解释句和布局稳定的 skeleton。

## 预览

以下截图由 `test/fixture.js` 的合成数据生成，不是真实个人会话。

| Light · 1440 | Dark · 1440 |
| --- | --- |
| ![light](docs/design-preview-light.png) | ![dark](docs/design-preview-dark.png) |

| Tablet · 1024 | Mobile · 390（无横向滚动） |
| --- | --- |
| ![tablet](docs/design-preview-1024.png) | ![mobile](docs/design-preview-mobile.png) |

切换范围时的组件级 skeleton（旧数据只作为布局壳，不显示旧数值）：

![pending](docs/design-preview-pending.png)

## 功能

| 区域 | 内容 |
| --- | --- |
| 左侧栏入口 | `sidebar.panellist` id `session-stats`，同时作为 `main` 面板 key |
| 全局范围 | 全部时间（默认）/ 近 7 天 / 近 14 天 / 近 30 天 |
| KPI strip | 总 Token、估算花费、平均每会话、缓存命中率；scoped 显示较上期变化，全部时间显示起始日/会话数/缓存读取等基线 |
| 每日消耗 | Token 堆叠柱；pastel 填充 + solid cap，灰色虚线为上一周期；底部日均，不重复总量 |
| Token 构成 | 环心显示占比最大的类别及其 share，图例给精确值 |
| 会话排行 | 按 Token 或时长排序；行底部 3px share bar；Token、占比、花费、时长 |
| 运行状态 | CPU 单核/整机、RSS、事件循环 p99、运行时长、PID/Node 版本、最近 5 分钟 CPU 曲线 |
| 刷新 | 5 秒轮询、页面隐藏暂停、切回立即刷新、手动刷新；失败指数退避 |
| 加载态 | 切换 period 不卸载页面；KPI/图表/构成/排行各自按真实尺寸 skeleton，柱图不重播入场动画 |

## 环境要求

- DeepSeek Harness **0.2.1-rc.5** 或兼容版本。
- Node.js **>= 22.15**（本仓库测试过 Node 22/24）。
- 本机有 DSH 会话目录（默认 `~/.dsh/sessions`）。
- `client.js` 已提交；插件管理器需要它存在。

## 安装

### 从本仓库本地安装

```bash
git clone https://github.com/starriv/dsh-session-dashboard.git
cd dsh-session-dashboard
npm ci
npm run build

plugin_manager install_bundle -> /absolute/path/to/dsh-session-dashboard
```

`plugin_manager install_bundle` 接收绝对路径。安装后侧栏出现「会话统计」，
首次打开或插件更新后刷新一次 Web GUI。Host 侧代码（`index.js`、`host/`）修改
需要重启 DSH 宿主；Client 侧 `client.js` 由插件管理器加载。

> 开发时也可以直接 `link:` 本地目录；`npm test` 的 `pretest` 会重新构建
> `client.js`，所以提交前务必把生成物一起提交。CI 会校验构建后可复现。

## 配置

`cordis.patch.yml` 的 row config（全部可选）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `scope` | `all` | Host 默认范围；**页面 UI 始终从「全部时间」启动**，选择器优先 |
| `trendDays` | `30` | 全部时间模式下趋势图天数，1–90 |
| `timeZone` | `Asia/Shanghai` | 日桶、峰时计价、窗口边界的 IANA 时区 |
| `refreshMs` | `1500` | 同一快照的最小重扫间隔 |
| `backgroundScanMs` | `60000` | 后台增量扫描间隔 |
| `runtimeSampleMs` | `5000` | 运行状态采样间隔 |
| `historySize` | `60` | CPU 曲线历史点数 |
| `maxSessions` | `2000` | 最多扫描会话文件数 |
| `maxFileBytes` | `256 MiB` | 未压缩日志文件上限 |
| `maxDecodedBytes` | `128 MiB` | 单文件解码后上限（zstd 与 plain JSONL 都生效） |
| `rankingLimit` | `100` | 排行最多返回条数 |
| `allowUnauthenticated` | `false` | 仅限隔离回环部署；无 `connection` 服务时若为 false 则元数据路由 fail-closed |
| `pricing` / `peakWindows` | 内置表 | 覆盖列表价或峰时窗口，不需要改代码 |

`scope` 只影响 Host 的默认 snapshot 范围；打开面板后由 UI 选择器决定。
`allowUnauthenticated` 会关闭鉴权，**不要**在可被网络访问的 Host 上启用。

## 数据口径

- **数据源**：`$DSH_HOME/sessions/<workspace>/<session>/session.vN.jsonl[.zstd]`，
  选择最高代际，压缩格式优先；多帧 zstd 逐帧解压。
- **Token**：只累加 provider usage 的 `inputTokens / outputTokens /
  cacheReadTokens / cacheWriteTokens`；总量为四项之和。
- **重试/流**：同一 `(turn, step)` 的后续样本替换旧样本；
  `llm/retry-started` 关闭替换槽；`assistant/attempt` 读取流内最后一个 usage。
- **Fork**：按 `session/end-seed` 的 `seq` 截断继承前缀，兼容历史 `seedLength`。
- **窗口**：按 `timeZone` 的自然日；scoped 的每日合计与 KPI 总量一致；
  上期是紧邻的同样长度窗口。
- **去重**：同一 header `id` 的复制/恢复会话只计最新一份。
- **缓存命中率**：`缓存读取 /（缓存读取 + 输入未命中）`。
- **费用**：逐样本按时间与模型计价，峰时/空闲分别取价；默认 CNY 列表价快照，
  **是估算，不是平台账单**。

峰时：`Asia/Shanghai` 工作日 09:00–12:00、14:00–18:00；空闲默认半价。
`pricing` 支持部分覆盖和 `null` 禁用模型；`peakWindows` 支持数字分钟或 `HH:MM`。

## 安全与隐私

- `/dsh-session-stats/snapshot` 返回会话标题、cwd、token 和费用；`/ping`
  也只返回插件与扫描状态。**两者使用同一个鉴权门**。
- 组合中存在 DSH `connection` 服务时，复用其 Host/Origin 校验、浏览器
  Cookie/API 凭证和连接 admission；无 Cookie 的 `curl` 返回 401。
- **没有 connection 服务时 fail-closed**：返回 `503 auth-unavailable`，
  除非显式配置 `allowUnauthenticated: true`。后者仅用于已有一层边界保护的
  隔离回环部署。
- 只读 `GET`/`HEAD`；请求参数不会进入文件路径；发现会话时跳过符号链接。
- 文件大小、解码输出、会话数量、排行数量都有上限；失败文件会计入 `errors`
  并在页面提示，不静默丢整个数据集。
- 响应带 `cache-control: no-store` 和 `x-content-type-options: nosniff`；
  内部错误只写 Host 日志，不返回给浏览器。
- 详细威胁模型和报告方式见 [SECURITY.md](SECURITY.md)。

## 工程化

```bash
npm ci          # 使用 package-lock.json
npm run build   # esbuild 生成 client.js（React 外置，d3 内联，CSS 注入）
npm test        # pretest 先构建；Node test runner 跑全部测试
npm pack --dry-run
```

- **构建契约**：`client.js` 使用 `window.__ModuleLoader__.load({ id, factory })`；
  只把 `react` / `react/jsx-runtime` 作为 external，d3 内联。
- **可复现**：仓库已提交 `client.js` 和 `package-lock.json`；CI 在 Ubuntu/macOS、
  Node 22/24 上执行 `npm ci`、`npm test`、`npm pack --dry-run`，并检查重建后的
  `client.js` 无 diff。
- **测试**：33 个 Node 测试，覆盖真实日志与官方 `tokenUsage` 对账、zstd 多帧/
  截断/损坏、重试与 fork、上期窗口、鉴权 fail-closed、恶意 usage/time 样本、
  重复 id、plain JSONL 预算、SSR/DOM、范围切换 skeleton、locale 与构建契约。
  基于 `~/.dsh/sessions` 的真实日志测试在没有会话时会跳过；CI 的合成测试仍运行。
- **发布物**：`npm pack` 包含 Host、client、locale、icon、manifest、README、
  docs 预览与法律文件；`private: true` 表示不使用 npm 公共注册表发布。

## 已知限制

- 费用是本地估算；价格或峰时策略变化时请用 `pricing`/`peakWindows` 覆盖。
- 直接读会话文件而非 Session 服务；正在追加的尾部帧会在下一次扫描计入。
- 历史 v0–v3 若尚未迁移到当前格式，usage 行可能不兼容。
- 首次冷扫描在 Host 主线程执行 JSON 解析；已加文件/解码/数量上限，但超大历史
  仍可能造成一次短暂卡顿。
- 全量扫描上限按路径排序，极多会话时可能遗漏部分旧会话；页面会提示 truncated。
- 页面从全部时间启动，Host 的 `scope` 默认值不会改变 UI 的初始选择。
- 预览截图来自合成 fixture + Host token 的静态渲染，不是登录态实时 GUI。

## 贡献与许可

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CHANGELOG.md](CHANGELOG.md)
- [SECURITY.md](SECURITY.md)
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

MIT © 2026 DSH Session Stats contributors.

设计参考：MIT-licensed
[dashboard-design skill](https://github.com/abdiraimov-otabek/dashboard-design-skill)；
本插件实现代码为原创 React/CSS/SVG。
