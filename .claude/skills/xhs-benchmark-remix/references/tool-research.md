# 小红书对标采集工具调研

## 技能市场

- 未检索到现成的“小红书对标采集与二创”技能，因此本技能采用自建流程。

## 2026-04 复查结论

用户提到的 Agent-Reach 确实已经在本机安装，但它不是小红书限制突破器：

- 本机 `where agent-reach` 可找到命令，`python -m pip show agent-reach` 显示版本 `1.4.0`。
- `npm view Agent-Reach version` 返回 404，说明它不是 npm registry 上的普通 npm 包。
- `agent-reach install --channels=xiaohongshu` 会检查/安装小红书渠道依赖，但实际底层仍是 `xhs-cli` / `xiaohongshu-cli`。
- `agent_reach/channels/xiaohongshu.py` 会调用 `xhs status` 判断是否可用；若底层返回 `not_authenticated` / `expired`，Agent-Reach 也只能提示重新登录。
- 用户提供的 Cookie 文件包含 `a1`，但 `xhs status --json` 返回 `Session expired`，所以不能继续真实站内采集。

因此本技能的工具判断原则是：先看真实登录态和搜索响应，不把“安装成功”误判为“采集可用”。

## 可参考工具

### 1. xiaohongshu-cli / xhs-cli（当前首选轻量 CLI）

- 地址：`https://github.com/jackwener/xiaohongshu-cli`
- 本机状态：`xhs, version 0.6.4`。
- 能力：自动提取浏览器 cookies、二维码登录、关键词搜索、笔记详情、评论、用户资料、发布图文笔记；支持 `--json` / `--yaml` 结构化输出。
- 关键路径：当前版本读取 `~/.xiaohongshu-cli/cookies.json`。
- 常用命令：

```bash
PYTHONIOENCODING=utf-8 xhs status --json
PYTHONIOENCODING=utf-8 xhs login --qrcode
PYTHONIOENCODING=utf-8 xhs login --cookie-source chrome
PYTHONIOENCODING=utf-8 xhs search "关键词" --json
PYTHONIOENCODING=utf-8 xhs read "https://www.xiaohongshu.com/explore/xxx?xsec_token=yyy" --json
```

- 适用：本地 CLI 工作流，尤其适合“搜索 + 阅读 + 评论 + 发布”全链路。
- 注意：Cookie 过期或账号风控时不可用；逆向接口可能随平台更新失效；读取详情常依赖 `note_id/feed_id + xsec_token`。

### 2. Agent-Reach（多平台聚合层，不是突破器）

- 地址：`https://github.com/Panniantong/Agent-Reach`
- 定位：多平台内容读取胶水层，让 Agent 通过统一命令检查/接入网页、YouTube、Reddit、B站、小红书等渠道。
- 本机状态：已安装 `agent-reach 1.4.0`，路径为 Python Scripts 下的 `agent-reach.exe`。
- 小红书渠道：底层依赖 `xhs-cli` / `xiaohongshu-cli`，或偏向小红书 MCP/Docker cookie 配置。
- 常用检查：

```bash
PYTHONIOENCODING=utf-8 agent-reach doctor
PYTHONIOENCODING=utf-8 agent-reach install --channels=xiaohongshu --dry-run
PYTHONIOENCODING=utf-8 agent-reach install --channels=xiaohongshu
PYTHONIOENCODING=utf-8 agent-reach configure --help
```

- 适用：用户希望一个 Agent 同时读多个平台，或已经把 Agent-Reach 当统一入口。
- 限制：不能绕过登录、验证码、风控、Cookie 过期或平台访问控制。小红书能否抓取最终仍以 `xhs status --json` 和真实搜索结果为准。

### 3. Playwright 隐匿/浏览器自动化方案

代表工具：

- `yangsijie666/xiaohongshu-crawler`
  - 基于 Playwright，支持搜索、详情、评论、JSON/Excel 导出，内置 MCP 服务。
  - 适用：需要结构化导出、评论采集、相对完整数据采集时。
  - 注意：安装依赖多、运行慢，仍需要登录，且要控制频率。
- `try-to-fly/xiaohongshu-cli`
  - TypeScript + Playwright CLI，支持搜索筛选：`--sort 最新/最多点赞/最多收藏`、`--type 图文`、`--time 一天内/一周内`。
  - 适用：当 Python 逆向 API 路线不可用，尝试真实浏览器自动化路线。
- `Manytw2/xhs-mcp`、`shanyang-me/xhs-mcp`、`xhs-mcp` npm 包
  - 多数基于 Playwright / Puppeteer / MCP，支持登录、搜索、详情、发布或爆款分析。
  - 适用：用户希望在 Claude/Cursor/CherryStudio 里以 MCP 工具形式调用。

统一注意：浏览器自动化不是无限制突破方案，仍要遵守平台规则，避免高频、批量、绕过验证码或访问控制。

### 4. 稳定商业 API / 托管采集服务（花钱买稳定时优先评估）

如果用户明确说“花点钱没事，但要稳定”，不要只停留在本地 CLI、浏览器自动化或 Agent-Reach。优先评估商业 API / 托管采集服务，因为它们通常已经处理账号池、代理、重试、字段结构化和任务队列，但仍要确认合规、预算、字段、频率和 SLA。

#### 4.1 OneAPI / GetOneAPI（当前主采集路径）

- 官网：`https://getoneapi.com/`
- 文档：`https://doc.getoneapi.com/`
- 鉴权：请求头 `Authorization: Bearer <API_KEY>`，不要把密钥写入技能、交付文件、日志或最终回复。
- 小红书常用端点：
  - 搜索笔记：`POST https://api.getoneapi.com/api/xiaohongshu/search_note`
  - 笔记详情：`POST https://api.getoneapi.com/api/xiaohongshu/fetch_video_detail`
  - 笔记评论：`POST https://api.getoneapi.com/api/xiaohongshu/fetch_video_comment`
  - 搜索联想词：`POST https://api.getoneapi.com/api/xiaohongshu/search_suggestion`
- 常用搜索参数：`keyword`、`page`、`sort=general/hot/new`、`noteType=all/video/normal`、`noteTime`。
- 价格实测/页面显示：普通小红书搜索、详情、评论约 `0.08 元/次`；V4/V6 详情约 `0.12 元/次`；蒲公英 V7 详情约 `0.20 元/次`。
- 已实测结果：
  - 搜索关键词“灵性”：HTTP 200，`code=200`，返回 20 条。
  - 搜索结果 Top10：10/10 有 note_id，10/10 有标题，10/10 有正文摘要，9/10 有点赞，10/10 有收藏，9/10 有评论，10/10 有图片。
  - 单条详情：HTTP 200，`code=200`，返回 `title`、`desc`、`user`、`time`、`liked_count`、`collected_count`、`comments_count`、`shared_count`、`view_count`、`images_list` 等字段。
- 当前结论：OneAPI 是小红书对标采集主路径；Just One API 降级为备用。
- 成本控制策略：每个主题先搜 3-5 个关键词；搜索结果缓存 24 小时；只抓 Top 5-10 条详情；评论只抓 Top 1-3 条高价值笔记。


- 常见参数：`keywords`、`maxItems`、`sortBy=general/time_descending/popularity_descending`、`noteType=all/video/normal`、`sessionCookie`、代理配置。
- 常见价格形态：按结果量计费，例如约 `$4.99 / 1,000 results`；也有月费 + 用量的 actor。
- 适用：一次性批量采集、趋势分析、竞品监控、需要快速拿 search/detail/comments/profile 的场景。
- 风险：不同 actor 质量差异很大；需要先小样本实测字段完整度、图片 URL 可用性、失败率和费用。

#### 4.2 Rnote / RedNote API

- 定位：更直接的小红书 / RedNote 数据 API 服务。
- 宣称能力：笔记详情、评论、用户、搜索、商品、话题、创作灵感、热门灵感等多端点。
- 适用：长期稳定接入、需要更完整站内数据字段、需要账号池/成功请求计费的场景。
- 评估重点：是否支持目标关键词搜索、热门排序、发布时间筛选、图文过滤、评论抓取、图片原链、失败重试、QPS、价格、合同/SLA、数据使用合规。

#### 4.3 Just One API 小红书接口

- 文档化接口能力：用户资料、用户发布笔记、笔记详情、笔记评论、笔记搜索、用户搜索、分享链接解析、关键词建议。
- 适用：需要稳定 REST API、关键词建议、笔记搜索、详情和评论的工作流。
- 评估重点：字段是否覆盖互动数据、图片、发布时间、链接、作者、评论；是否支持批量；是否有速率限制和失败收费规则。

### 5. 大模型在采集链路里的正确位置

大模型不能替代真实小红书采集，也不能凭空给出“站内高赞高藏数据”。它适合做：

- 关键词扩展：从核心赛道扩展人群词、痛点词、场景词、竞品词、热词。
- 热点理解：把当日热点转译成可用选题角度，判断是否能自然接入。
- 爆款结构分析：拆标题钩子、首图策略、正文结构、评论诱因。
- 二创编排：把对标样本和热点重新组合成有收藏感、干货感、转发感的内容。
- 质检：检查标题党、洗稿、侵权、硬蹭热点、图片内部标签、干货不足等问题。

不要让大模型伪造互动数据、来源链接、站内排名或“今日小红书热榜”。如果没有真实采集结果，必须标注为公开资料兜底或策略推演。

### 6. 逆向/签名/API 代采类项目

代表搜索结果包括 `xhs996/xhs_spider` 等，常提到 App/Web 算法、xsec_token、x-s、x-s-common、App Shield 等。

- 适用：一般不作为本技能默认路线。
- 原因：维护成本高、合规风险高、容易涉及绕过风控或访问控制。
- 技能处理原则：可以把它们作为“存在这种路线”的情报，但不要主动指导绕过验证码/风控/签名限制；用户没有明确合法授权和预算时，优先走 CLI/MCP/公开资料兜底。

## 推荐工具选型矩阵

| 场景 | 首选 | 备选 | 说明 |
|---|---|---|---|
| 小红书日常内容生产采集 | OneAPI / GetOneAPI | Just One API | OneAPI 已实测搜索/详情可用，普通接口约 0.08 元/次，必须缓存和限量抓取 |
| 本地轻量搜索/阅读 | `xiaohongshu-cli` | Agent-Reach 调度 `xhs-cli` | 先验证 `xhs status --json` |
| Agent 统一多平台读取 | Agent-Reach | 手动调用各 CLI | Agent-Reach 不绕过小红书限制 |
| 需要 MCP 给 AI 直接调 | Playwright/MCP 类 xhs 工具 | `xiaohongshu-crawler` | 适合搜索、详情、评论结构化 |
| 需要“最多点赞/最多收藏/近一周”筛选 | Playwright CLI 或 Apify | xhs-cli + 后处理排序 | 具体以工具参数为准 |
| 本地登录过期/接口风控 | 重新扫码/重新导出 cookie | 换正常账号/降频 | 不要承诺突破限制 |
| 一次性商业采集 | Apify | 其他合规数据服务 | 先确认预算、字段、失败率和用途 |
| 长期稳定 API 接入 | Rnote / Just One API | Apify Actor | 先用小样本测试 search/detail/comments/images/排序能力 |
| 需要“花钱买稳定” | 商业 API / 托管采集服务 | 本地 CLI 作补充校验 | 不要把 Agent-Reach 当作稳定采集能力本体 |
| 无法真实抓取但仍要交付二创 | 公开资料兜底 | 用户人工给链接/截图 | 必须标注不是真实站内高赞数据 |

## 推荐整合策略

1. 先检查用户本地已有登录态与工具，不重复造轮子。
2. 如果用户愿意安装工具，优先尝试 `xiaohongshu-cli` 或 MCP 化工具；Agent-Reach 作为聚合层，不作为突破限制的承诺。
3. 如果用户明确要求稳定、可付费、可长期拿结果，优先做商业 API 小样本实测：Apify 适合快速试跑，Rnote / Just One API 适合评估长期 API 接入。
4. 对“近 3 天、高赞高藏、当日热点”任务，真实采集优先使用支持时间、热度、类型、评论和图片字段的工具；如果工具不支持，采集后在本地按发布时间和互动数据二次筛选。
5. 无论使用哪个工具，后续二创流程保持一致：筛选、热点编排、归档、结构分析、文字重写、图片重做、发布包输出。
6. 真实抓取失败时，切公开资料兜底，但必须在任务简报、分析表和 manifest 中写清“非真实站内高赞高藏采集”。

## 商业 API 小样本验收标准

正式花钱前，先用 3-5 个关键词做小样本测试。能通过下面标准，才算“可以稳定拿结果”：

| 验收项 | 合格标准 |
|---|---|
| 搜索结果 | 每个关键词能稳定返回足量笔记，且不是大量无关内容 |
| 排序能力 | 支持热度/最新/综合，或返回足够互动字段供本地排序 |
| 图文过滤 | 能区分图文/视频，至少能保留图片链接或图片资源 |
| 详情字段 | 标题、正文、作者、链接、发布时间、点赞、收藏、评论、分享尽量齐全 |
| 评论/情绪 | 能抓评论或高频评论，用于判断用户真实痛点 |
| 图片可用性 | 图片 URL 可下载，或服务能返回可访问资源 |
| 稳定性 | 连续多次任务失败率可接受，有错误码和重试策略 |
| 成本 | 单条有效笔记成本可控，失败请求是否收费要清楚 |
| 合规 | 数据用途、账号权限、平台规则、隐私边界可接受 |

推荐实测顺序：

1. **Apify**：最快验证商业托管是否能拿到 search/detail/comments/images。
2. **Rnote / RedNote API**：如果要长期稳定和更完整端点，再重点评估。
3. **Just One API**：如果需要文档化 REST 接口、关键词建议、笔记搜索和评论能力，作为并行候选。
4. **本地 xhs-cli / MCP / Playwright**：作为低成本试跑、人工复核或 API 失败时的补充，不作为唯一生产依赖。

