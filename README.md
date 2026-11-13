# 会话统计 · DSH Session Dashboard

[![CI](https://github.com/starriv/dsh-session-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/starriv/dsh-session-dashboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

DSH Session Dashboard 是 DeepSeek Harness Web GUI 的会话统计插件。它在本机读取
DSH 会话日志，提供 Token 用量、费用估算、每日趋势、Token 构成、会话排行和宿主
运行状态，并从左侧栏的「会话统计」进入。

界面使用 DSH 的主题变量，支持浅色、深色和窄屏布局。切换统计范围时，页面保留
现有结构，各区域显示与真实内容尺寸一致的加载占位，避免整页闪烁和布局跳动。

## 界面预览

预览使用仓库内的合成测试数据，不含真实会话内容；主视图为默认的「全部时间」范围，
最后一张展示切换到「近 7 天」时的加载占位。

| 浅色 · 1440 | 深色 · 1440 |
| --- | --- |
| ![浅色界面](docs/design-preview-light.png?v=1.4.2) | ![深色界面](docs/design-preview-dark.png?v=1.4.2) |

| 平板 · 1024 | 手机 · 390（无横向滚动） |
| --- | --- |
| ![平板界面](docs/design-preview-1024.png?v=1.4.2) | ![手机界面](docs/design-preview-mobile.png?v=1.4.2) |

切换范围时的加载占位：

![加载占位](docs/design-preview-pending.png?v=1.4.2)

## 功能

| 区域 | 内容 |
| --- | --- |
| 左侧栏入口 | `sidebar.panellist` 的 `session-stats` 入口，同时对应 `main` 面板 key |
| 全局范围 | 全部时间（默认）、今日、近 7 天、近 14 天、近 30 天 |
| 今日口径 | 按用户浏览器所在时区的自然日统计当天 0 点到现在，对比上一日 |
| 概览指标 | 总 Token、估算花费、平均每会话、缓存命中率；选择范围时显示与上一周期的变化（无上期数据时以所选窗口起始日期为基线），全部时间显示历史起始日期等基线信息 |
| 每日消耗 | 按 Token 类型堆叠的柱状图；虚线表示上一周期，图表底部显示日均值 |
| Token 构成 | 环形图，中心显示占比最高的类别；图例列出各项精确值与占比 |
| 会话排行 | 按 Token 或活跃时长排序；每行底部显示占比条，列出 Token、占比、花费、活跃时长和总时长，两张时长列悬停可看首末活动时间 |
| 运行状态 | CPU 单核/整机占用、RSS、事件循环 p99、运行时长、PID、Node 版本和最近 5 分钟 CPU 曲线 |
| 刷新机制 | 页面打开时每 5 秒刷新；页面隐藏时暂停，恢复可见后立即刷新；失败后逐步退避；支持手动刷新 |
| 加载状态 | 切换范围时保留页面布局，各区域显示与真实内容尺寸一致的占位；图表不重播入场动画 |

## 环境要求

- DeepSeek Harness 0.2.1-rc.5 或兼容版本。
- Node.js >= 22.15（CI 覆盖 Node 22 和 24）。
- 本机存在 DSH 会话目录，默认位于 `~/.dsh/sessions`。
- 仓库内包含预构建的 `client.js`，插件管理器安装时需要该文件。

## 安装

### 从 npm 安装

```text
plugin_manager install_bundle -> dsh-session-dashboard
```

DSH 会从已配置的 npm registry 解析最新版本。以 registry 包安装后，插件管理页会在
有新版本时显示「可更新」，并可直接更新到最新版本。

### 从源码或本地 checkout 安装（开发）

```bash
git clone https://github.com/starriv/dsh-session-dashboard.git
cd dsh-session-dashboard
npm ci
npm run build
```

然后在插件管理器中执行 `install_bundle`，目标选择该仓库的绝对路径。安装完成后，
左侧栏会出现「会话统计」入口；首次打开或插件更新后刷新一次 Web GUI。

Host 侧代码（`index.js`、`host/`）修改后需要重启 DSH 宿主。Client 侧由插件管理器
加载 `client.js`。本地 `link:` 或路径安装属于开发方式，DSH 不会为其提供 registry
更新徽标；需要自动更新能力时请使用 npm 安装。

`npm test` 会先通过 `pretest` 重新生成 `client.js`。提交源码变更时请一并提交构建
产物；CI 会校验构建结果是否与仓库中的文件一致。

## 配置

`cordis.patch.yml` 中的 row config 均可选：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `scope` | `all` | Host 侧默认统计范围；页面打开时仍从「全部时间」启动，以选择器为准 |
| `trendDays` | `30` | 全部时间模式下趋势图显示的天数，范围 1–90 |
| `timeZone` | `Asia/Shanghai` | 峰谷计价窗口使用的 IANA 时区；也是浏览器未上报时区或上报非法时区时的日历日兜底 |
| `refreshMs` | `1500` | 同一份快照的最小重新扫描间隔 |
| `backgroundScanMs` | `60000` | 后台增量扫描间隔 |
| `zoneRebuildMs` | `30000` | 切换到日历日不同的时区时，两次整库重解析的最小间隔（毫秒，0 关闭）；防止多时区轮询反复重扫 |
| `runtimeSampleMs` | `5000` | 运行状态采样间隔 |
| `historySize` | `60` | CPU 曲线保留的历史点数 |
| `idleGapMinutes` | `10` | 活跃时长的空闲阈值（分钟，1–120）：相邻事件间隔超过该值即视为离开会话，不再计入时长 |
| `maxSessions` | `2000` | 单次扫描的会话文件上限 |
| `maxFileBytes` | `256 MiB` | 未压缩日志文件的大小上限 |
| `maxDecodedBytes` | `128 MiB` | 单文件解码后的输出上限，zstd 和 plain JSONL 均生效 |
| `rankingLimit` | `100` | 排行返回的最大条数 |
| `allowUnauthenticated` | `false` | 无 `connection` 服务时是否允许无鉴权访问；默认拒绝，仅限隔离回环部署 |
| `pricing` / `peakWindows` | 内置表 | 覆盖模型价格或峰时窗口，无需修改代码 |

`scope` 只影响 Host 侧默认快照范围，打开面板后由界面选择器决定。界面日历日以浏览器上报的
IANA 时区为准：`timeZone` 只在请求未带 `tz`（例如直接用 API 访问）或 `tz` 非法时兜底，
并继续用于峰谷计价。
`allowUnauthenticated` 会关闭元数据路由的鉴权，不应在可被网络访问的 Host 上启用。

## 数据口径

- **数据源**：`$DSH_HOME/sessions/<workspace>/<session>/session.vN.jsonl[.zstd]`，
  选择最高代际，压缩格式优先；多帧 zstd 逐帧解压。
- **Token**：只统计 provider usage 中的 `inputTokens`、`outputTokens`、
  `cacheReadTokens` 和 `cacheWriteTokens`，总量为四项之和。主循环样本与官方
  `tokenUsage` 投影逐项对账；此外也计入 `compaction/summary` 中 provider 上报的
  上下文压缩调用用量（一次独立的计费请求，同一 `compactionId` 只计一次）。官方
  `tokenUsage` 投影不含压缩调用，因此发生过压缩的会话可能略高于该投影。
- **重试与流式响应**：同一 `(turn, step)` 的后续样本替换旧样本；
  `llm/retry-started` 结束当前替换槽；`assistant/attempt` 读取流内最后一个 usage。
  压缩调用不属于 `(turn, step)` 流，不进入替换槽。
- **分叉会话**：按 `session/end-seed` 的 `seq` 截断继承前缀，兼容历史 `seedLength`。
- **时间窗口**：按**用户浏览器所在时区**的自然日划分；前端每次请求都会上报 IANA 时区，
  「今日」即用户本地时区的当天 0 点到现在。`timeZone` 只在浏览器未上报或上报非法时兜底，
  并继续决定峰谷计价窗口。所有范围共用同一套用户时区日历，所选范围的每日合计与概览
  总量一致；上一周期是与当前范围相邻、长度相同的窗口。
- **时区切换**：同一 Host 被不同时区的浏览器访问时，会按新时区重新划分日桶。日历日
  相同的时区（例如两个 UTC+8 时区）只改标签、不重扫；日历日不同时交给一份备用解析
  缓存，两个时区交替轮询不会每请求重扫。超过两个日历日不同的时区交替访问时才会重建，
  且两次整库重建至少间隔 `zoneRebuildMs`（默认 30 秒）；被限频的请求继续返回当前
  日历口径，并以响应里的 `timeZone` 为准。判断“日历日相同”只覆盖视图可能聚合的最近
  `2 × 90` 天（范围窗口与上一周期）以及可能存在的未来日桶；更早的日桶不会再进入任何
  窗口。
- **会话时长**：排行同时显示两列口径，避免把“日志存活时间”误读成“实际工作时长”。
  - **活跃时长**：把会话自身的每个事件时间合并成活跃区间——相邻事件间隔不超过
    `idleGapMinutes`（默认 10 分钟）即视为同一次连续工作，超过则开启新的区间；
    各区间长度之和就是活跃时长。长时间挂起、隔天才继续的会话不会再显示几十甚至
    几百小时。分叉会话继承的前缀事件和 `session/end-seed` 边界标记不计入。
  - **总时长**：会话创建到最后一次真实活动的墙钟跨度（旧版唯一口径），包含
    空闲和跨天挂起，用于解释活跃时长为何可能远小于总时长。它会忽略
    `session/end-seed` 这类在会话收尾时才落盘的边界标记，避免被几天后才写入的
    尾标记拉长成几百小时。
  选择范围时两列都会裁剪到所选窗口内；悬停可看到活跃时长的首末活动时间、活动
  跨度，以及总时长的会话跨度。
- **去重**：同一 header `id` 的复制或恢复会话只计最新一份。
- **缓存命中率**：`缓存读取 /（缓存读取 + 输入未命中）`。
- **费用**：每个样本按发生时刻与模型计价，峰时与空闲分别取价；默认使用 CNY 列表价
  快照，结果为估算值，不代表平台账单。

峰时窗口默认为**北京时间**（由 `timeZone` 决定，默认 `Asia/Shanghai`）周一至周五
09:00–12:00 和 14:00–18:00，其余时段（含周末）为空闲；空闲价默认是高峰价的一半。
`flat: true` 的模型不享受隐式峰谷折扣。`pricing` 支持部分覆盖，也可用 `null` 禁用
某个模型；`peakWindows` 支持数字分钟或 `HH:MM` 格式。

内置 DeepSeek 价格快照（CNY / 百万 Token，核对日期 2026-11-10）：

| 模型 | 缓存命中（空闲 / 高峰） | 缓存未命中（空闲 / 高峰） | 输出（空闲 / 高峰） |
| --- | ---: | ---: | ---: |
| `deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、兜底 | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / **27.0** |

来源为 DeepSeek 官方[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)页
（英文页 USD 表同比例）。旧模型名 `deepseek-v4-flash` 与
`deepseek-v4-flash-vision-exp` 现由 DeepSeek-V4.1-Flash 承接并按 Flash 价格计费。
官方价目表没有缓存写入计费项，实际样本中 `cacheWriteTokens` 恒为 0。

### 估算范围

「估算花费」只覆盖会话日志里 provider 上报的 Token 用量。以下开销不在估算内，
也不做猜测性补价：

- **Search / Fetch 次数费**：自北京时间 2026-11-01 00:00 起，DeepSeek 对成功请求按
  5 元 / 千次计费。日志记录工具调用及其整体结果（`tool/result`），但一次模型请求
  可能触发多次服务端计费请求，无法据此还原成功请求数与金额。
- **标题生成与会话内网页搜索的模型调用**：日志中有请求体但没有 usage 记录，
  无法按 Token 计价。
- **中断或失败的请求**：`interrupted` 的消息、失败的尝试可能只有部分计费，
  日志未上报 usage。
- **同一账号下其他客户端的用量**：插件只读取本机 `$DSH_HOME/sessions`。

### GPT-6 Astra 估算与上下文阶梯

`gpt-6-astra` 不再落入 Flash 兜底。内置价格来自
[Token Usage 同源社区价表](https://github.com/LaoYueHanNi/model-price-table) 的 v130 快照
（`updatedAt: 1793784668`），不是供应商实际账单，也不会自动联网同步。

| CNY / 百万 Token | 输入未命中 | 输出 | 缓存读取 | 缓存写入 |
| --- | ---: | ---: | ---: | ---: |
| 输入侧上下文 < 272,000 | 70 | 350 | 7 | 87.5 |
| 输入侧上下文 >= 272,000 | 140 | 525 | 14 | 175 |

输入侧上下文 = **每次请求**的输入未命中 + 缓存读取 + 缓存写入，不含输出。
达到阈值时整次请求使用高档价格，不是只对超出部分加价，也不按会话累计用量选档。
Astra 全天、周末同价；`gpt-6-astra-fast` 等变体不会被当作 Astra 别名。

价格条目支持 `flat: true` 与 `contextTiers: [{ threshold, peak, idle? }]`；选择达到的
最高阈值。部分覆盖继承已有价格及档位，显式 `contextTiers: []` 关闭阶梯。
`provider/model` 覆盖仍优先于裸模型名。有效档位及快照来源包含在 `pricing` 响应中。

Astra 的这次变更不涉及其他模型的兜底价格、峰谷行为与 Token 归并范围（压缩调用的
计费口径见上文「数据口径」）。价格代码更新后需重新加载插件，重建内存中的历史计价
缓存；仅刷新浏览器不会重算旧 Host 缓存。

## 安全与隐私

- `/dsh-session-stats/snapshot` 返回会话标题、cwd、token 和费用；
  `/dsh-session-stats/ping` 返回插件与扫描状态。两者使用相同的鉴权校验。
- 组合中存在 DSH `connection` 服务时，复用其 Host/Origin 校验、浏览器
  Cookie/API 凭证和连接准入；无 Cookie 的 `curl` 请求返回 401。
- 没有 `connection` 服务时默认拒绝访问，返回 `503 auth-unavailable`。
  仅在已有一层访问边界保护的隔离回环部署中，才应显式启用
  `allowUnauthenticated`。
- 路由只接受 `GET` 和 `HEAD`；请求参数不会进入文件路径；发现流程跳过符号链接。
- 文件大小、解码输出、会话数量和排行条数均有上限。单个文件失败会计入 `errors`
  并在页面提示，不会清空已有统计。
- 响应包含 `cache-control: no-store` 和 `x-content-type-options: nosniff`；
  内部错误只写入 Host 日志，不返回给浏览器。
- 完整威胁模型和漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 构建、测试与发布

```bash
npm ci
npm run build
npm test
npm pack --dry-run
```

- **模块格式**：`client.js` 使用 `window.__ModuleLoader__.load({ id, factory })`；
  `react` 和 `react/jsx-runtime` 作为外部依赖，d3 打包进产物。
- **构建可复现**：仓库提交了 `client.js` 和 `package-lock.json`。CI 在 Ubuntu
  Node 22/24 和 macOS Node 22 上执行 `npm ci`、`npm test`、`npm pack --dry-run`，
  并检查重建后的 `client.js` 与提交文件无差异。
- **测试覆盖**：70 个 Node 测试，覆盖真实日志与官方 `tokenUsage` 对账、压缩调用计费、
  活跃时长区间合并与范围裁剪、zstd 多帧/截断/损坏、重试与分叉、上期窗口、鉴权默认拒绝、
  异常 usage/time 样本、重复 id、plain JSONL 预算、SSR/DOM、范围切换加载占位、
  locale 和构建模块格式。
  依赖 `~/.dsh/sessions` 的真实日志测试在无会话时跳过；合成数据测试仍会执行。
- **发布内容**：`npm pack` 包含 Host、client、locale、icon、manifest、README、
  docs 截图和法律文件。`private: true` 表示该包不通过 npm 公共注册表发布。

## 已知限制

- 费用为本地估算；价格或峰时策略变化时，请使用 `pricing` 或 `peakWindows` 覆盖。
  内置价格是快照，不会自动联网同步。
- 未内置中国法定节假日日历：官方在法定节假日**全天**按空闲价计费，插件仍按工作日峰时
  计价，因此法定假日附近的工作时段会略偏高（只会偏高，不会偏低）。
- 价格表按模型名精确匹配，未识别的模型回退到 Flash 价格；新增的付费模型请用
  `pricing` 显式配置，否则会按较低价格估算。
- Search / Fetch 次数费、标题生成与会话内网页搜索的模型调用、中断请求的未上报用量，
  以及同一账号下其他客户端的消费都不在估算内，详见上文「估算范围」。
- 当前直接读取会话文件，而非通过 Session 服务；正在追加的尾部帧会在下一次扫描时计入。
- 历史 v0–v3 日志若尚未迁移到当前格式，usage 行可能无法完整解析。
- 首次冷扫描在 Host 主线程执行 JSON 解析；已设置文件、解码和数量上限，但超大历史
  仍可能造成一次短暂卡顿。
- 全量扫描上限按路径排序，会话数量极多时可能遗漏部分旧会话；页面会显示截断提示。
- 日历日按请求方（浏览器）时区划分。Host 最多保留两份日历日不同的解析结果（当前与
  备用）；同时被三个及以上不同日历日的时区轮询时，整库重建受 `zoneRebuildMs` 限制，
  限频期间个别请求会拿到另一日历口径的数据（响应 `timeZone` 会标明），下一次窗口
  打开后自动纠正。本地单用户通常只有一种时区，不会触发。
- 页面固定从「全部时间」启动，Host 的 `scope` 默认值不会改变界面的初始选择。
- 活跃时长基于会话事件时间戳推断：主机时钟跳变、日志被手工修改或非正常追加时，
  结果可能与真实交互时间有偏差；它是工作量参考指标，不是计费或考勤依据。
- 预览截图来自合成测试数据和 Host 主题变量的静态渲染，不是登录态实时界面。

## 贡献与许可

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CHANGELOG.md](CHANGELOG.md)
- [SECURITY.md](SECURITY.md)
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

MIT © 2026 DSH Session Stats contributors.

界面设计参考了 MIT 许可的
[dashboard-design skill](https://github.com/abdiraimov-otabek/dashboard-design-skill)；
本仓库的实现代码为独立编写。
