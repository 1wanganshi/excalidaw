# 本轮跑通流程与踩坑记录

这份记录用于把实际跑过的小红书对标二创流程固定成可复用 SOP。

## 1. Agent-Reach 实际安装方式与本机状态

用户提供过 npm/SSH 安装命令：

```bash
npm install Agent-Reach --repository git+ssh://github.com/agent-reach-io/agent-reach.git
```

这不是推荐路线，原因：

- `--repository` 不是 npm install 的有效安装方式；
- `Agent-Reach` 不是 npm registry 上的合法包名，npm 包名不能包含大写字母；
- `agent-reach-io/agent-reach` 需要 SSH 权限或不是当前公开主仓库；
- Agent-Reach 当前公开路线是 Python CLI / GitHub 项目，不应按普通 npm 包判断。

本机 2026-04-25 复查结果：

```text
where agent-reach
→ C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\Scripts\agent-reach.exe

python -m pip show agent-reach
→ Name: agent-reach
→ Version: 1.4.0
→ Editable project location: D:\yiren\抓取并转化\tools\agent-reach

npm view Agent-Reach version
→ 404 Not Found
```

结论：本机已安装 Agent-Reach 1.4.0，但不是 npm 包安装。

实际可用路线：

```bash
git clone "https://github.com/Panniantong/Agent-Reach.git" "D:/yiren/抓取并转化/tools/Agent-Reach"
PYTHONIOENCODING=utf-8 python -m pip install -e "D:/yiren/抓取并转化/tools/Agent-Reach"
agent-reach install --env=auto
agent-reach install --channels=xiaohongshu
```

推荐先预演：

```bash
PYTHONIOENCODING=utf-8 agent-reach install --channels=xiaohongshu --dry-run
PYTHONIOENCODING=utf-8 agent-reach install --channels=xiaohongshu --safe
```

本机执行 `agent-reach install --channels=xiaohongshu` 的结果：

- Agent-Reach 已安装；
- 小红书渠道依赖 `xhs-cli` 已安装；
- 但 `agent-reach doctor` 仍未显示小红书渠道可用，因为底层登录态未通过；
- `xhs status --json` 返回 `Session expired — please re-login with: xhs login`。

Windows + Git Bash 里涉及中文路径时，命令参数要加引号；运行 Python/CLI 时建议加：

```bash
PYTHONIOENCODING=utf-8
```

避免中文输出乱码或 emoji 编码报错。

## 2. Agent-Reach 与小红书的真实关系

Agent-Reach 本身不是新的小红书破解/突破工具，它的小红书渠道底层依赖 `xhs-cli` / `xiaohongshu-cli`，或在某些配置中依赖小红书 MCP / Docker 容器。

源码确认：`agent_reach/channels/xiaohongshu.py` 的 `XiaoHongShuChannel.check()` 会查找 `xhs` 命令，并执行 `xhs status`。当输出包含 `not_authenticated` 或 `expired` 时，只提示运行 `xhs login`。

所以判断顺序应为：

1. `where agent-reach` / `agent-reach --version` 是否存在；
2. `agent-reach doctor` 是否显示总体渠道状态；
3. `agent-reach install --channels=xiaohongshu` 是否完成小红书渠道依赖；
4. `xhs-cli` / `xiaohongshu-cli` 是否安装成功：`xhs --version`；
5. `xhs status --json` 是否 authenticated；
6. 真实搜索接口是否返回数据；
7. 是否出现平台风控/账号异常。

本轮结果：

- Agent-Reach 已安装：`agent-reach 1.4.0`；
- 小红书渠道安装命令可运行，且提示 `xhs-cli already installed`；
- `xhs-cli` 已存在：`xhs, version 0.6.4`；
- 用户给的 Cookie 文件格式有效，包含 `a1`，但写入 `~/.xiaohongshu-cli/cookies.json` 后，`xhs status --json` 返回：`Session expired — please re-login with: xhs login`；
- 执行 `agent-reach configure xhs-cookies '<cookie json>'` 时，Agent-Reach 解析到 16 个 cookies，但提示 `xiaohongshu-mcp container is not running`，说明该配置路径偏向 MCP/Docker 容器，不会直接修复 `xhs-cli` 的过期登录态。

结论：Agent-Reach 不能绕过小红书登录、验证码、风控或会话过期。不要承诺“装了 Agent-Reach 就能抓”。它的价值是把多平台入口统一起来，并在底层渠道可用时让 Agent 更方便调用。

## 3. 本机已发现的小红书相关路径

### xhs-poster cookies

```text
C:\Users\Lenovo\.media-mcp\accounts\default\cookies.json
```

用途：本地 `xhs-poster` 发布插件保存的登录 cookies。里面有 `a1`、`web_session` 等小红书 cookie，但不要打印 cookie 值。

### xhs_mcp cookies

```text
C:\Users\Lenovo\.xhs-mcp\cookies.json
```

用途：Python `xhs_mcp` 默认读取位置。本轮曾把 `xhs-poster` cookies 同步到这里。

### xhs_mcp 服务文件

```text
C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\Lib\site-packages\xhs_mcp\server.py
```

关键点：`search_feeds(keyword, sort="general", note_type=0)` 使用 `/api/sns/web/v1/search/notes`。

### xiaohongshu-cli / xhs 包

```text
C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\Lib\site-packages\xhs\core.py
C:\Users\Lenovo\AppData\Roaming\uv\tools
```

`uv tool list` 曾显示：

```text
xiaohongshu-cli v0.6.4
- xhs
```

## 4. 小红书登录与风控判断 SOP

### 4.1 标准检查命令

先执行：

```bash
PYTHONIOENCODING=utf-8 xhs status --json
```

常见结果：

### A. 未登录

```json
{
  "ok": false,
  "error": {
    "code": "not_authenticated",
    "message": "No 'a1' cookie found..."
  }
}
```

处理：

- 让用户在浏览器登录 `xiaohongshu.com`；
- 优先用 Cookie-Editor 导出 Header String；
- 按 Agent-Reach 指引执行：

```bash
agent-reach configure xhs-cookies "导出的cookie字符串"
```

如果该命令不可用，再查 Agent-Reach 当前版本配置命令，不要猜测写入路径。

### B. 已登录但 API 风控

例如：

```json
{"code":300011,"success":false,"msg":"当前账号存在异常，请切换账号后重试","data":{}}
```

处理：

- 不要绕过平台风控；
- 说明账号/接口被限制；
- 建议换正常账号或重新导出 Cookie；
- 可先启用“公开资料兜底模式”完成发布包。

### C. Cookie 文件存在但会话过期

本轮用户提供浏览器导出的 Cookie-Editor JSON 文件，检查结果：文件存在、16 个 cookie、包含 `a1`。导入到 `~/.xiaohongshu-cli/cookies.json` 后，`xhs status --json` 返回：

```json
{
  "ok": false,
  "error": {
    "code": "not_authenticated",
    "message": "Status check failed: Session expired — please re-login with: xhs login"
  }
}
```

处理：

- 不要继续反复复制同一份 cookie；结构正确但 session 已过期；
- 不要打印 cookie 值；
- 建议用户重新登录小红书后重新导出 Cookie-Editor JSON，或直接扫码登录：

```bash
PYTHONIOENCODING=utf-8 xhs login --qrcode
```

或从浏览器提取：

```bash
PYTHONIOENCODING=utf-8 xhs login --cookie-source chrome
```

若使用 Agent-Reach：

```bash
PYTHONIOENCODING=utf-8 agent-reach doctor
PYTHONIOENCODING=utf-8 agent-reach configure xhs-cookies "<Cookie-Editor JSON 或 Header String>"
```

但要注意：`agent-reach configure xhs-cookies` 在当前版本里偏向写入 `xiaohongshu-mcp` Docker 容器或 `~/.agent-reach/xhs-cookies.json`，不等同于修复 `xhs-cli` 登录态。最终仍以 `xhs status --json` 和真实搜索响应为准。



## 5. 公开资料兜底模式

当真实小红书搜索被登录、风控、超时卡住时，不要虚构“已采集高赞笔记”。采用兜底模式：

1. 明确标注：本轮不是直接抓取小红书高赞数据，而是基于公开可访问资料/结构资料试跑；
2. 保留来源链接；
3. 输出仍按完整发布包结构交付；
4. `risk_note` 写清“未直接复用原图/原文，建议人工复核”；
5. 图片用原创生成或后续补 image2image，不要声称已基于真实原图二创。

本轮兜底输出目录：

```text
D:\yiren\抓取并转化\outputs\xhs_benchmark_20260424_lazy_storage
```

公开参考来源包括：

- `https://xiaohongshu-pc.org/archives/1152`
- `https://xiaohongshu-pc.org/archives/1076`
- `https://xiaohongshu-pc.org/archives/1182`
- `https://xiaohongshu-pc.org/archives/1212`
- `https://m.zhuxiaobang.com/article/6956834020340695588`
- `https://m.zhuxiaobang.com/article/6977181300226523661`

## 6. 配图缺失纠正与强制降级规则

2026-04-25 用户明确纠正：每一次小红书二创/图文/发布包任务里，“配图”是必然要存在的；没有配图是不符合预期的交付错误。

以后执行该类任务时：

1. 不得把配图当成可选项，也不得因为用户没有额外说“生成图片”就跳过配图；
2. 不得因为真实小红书采集失败而省略配图。真实采集失败时，应进入公开资料兜底 + 原创多图卡片方案，或在有出图工具时直接生成原创多图卡片；
3. 不得因为没有 `GEEKNOW_API_KEY` / `OPENAI_API_KEY` 而省略配图。没有 key 时，必须交付每篇独立的：

```text
图片内容脚本.md
配图提示词.json
配图/                  # 占位目录
补图清单.md             # 写清缺失图片、原因和补跑动作
```

4. 有图片 API Key 或可用出图工具时，应生成实际图片并校验落盘：检查每篇图片数量、文件大小、路径、发布表状态；
5. 如果批量生图部分失败，不要直接报告“失败结束”；读取 manifest/error，补跑失败项，直到图片全量落盘，或记录不可恢复原因并保留补图清单；
6. 汇报完成时必须明确图片状态：
   - `已生成图片，可人工复核发布`；
   - `待补图，脚本和提示词已齐全`；
   - `接口失败，已记录失败原因和补跑命令`。

这一条优先级高于轻量执行策略：轻量版可以减少采集量、减少二创篇数，但不能取消配图成果。

## 7. GPTimage2 批量出图脚本

已把本轮跑通脚本固化到：

```text
scripts/generate_images_gateway.py
```

用途：读取每个 `04_publish_pack/note_xxx/image_prompt.txt`，调用 OpenAI 兼容接口生成 PNG，保存到对应 `images/` 文件夹，并写入：

```text
03_remix/image_generation_results.json
```

推荐调用方式：

```bash
GEEKNOW_API_KEY="环境变量里设置，不要写进文件" PYTHONIOENCODING=utf-8 python "<skill_path>/scripts/generate_images_gateway.py" \
  --root "D:/yiren/抓取并转化/outputs/任务目录" \
  --base-url "https://www.geeknow.top" \
  --model "gpt-image-2" \
  --size "1024x1536" \
  --original \
  --update-sheet
```

参数说明：

- `--original`：没有真实参考图时，明确按原创封面生成；
- `--update-sheet`：自动更新 `04_publish_pack/publish_sheet.csv` 的图片状态；
- `--mode auto`：默认先尝试 `/v1/images/generations`，失败后尝试 `/v1/chat/completions` 包装；
- `--limit N`：只试跑前 N 条。

安全注意：API Key 只能通过环境变量传入，不能写入脚本、CSV、Markdown、日志文件。若 key 已出现在对话或命令历史里，建议用户轮换。

## 8. 发布包验收清单

每条 `note_xxx` 必须包含：

```text
note_xxx/
├── images/              # 至少 1 张可发布图片；若未生成，则必须有待生成占位和补图清单
├── title.txt            # 最终标题
├── body.txt             # 正文
├── hashtags.txt         # 话题标签
├── source.md            # 来源/对标说明/风险
├── image_prompt.txt     # 出图提示词
├── 图片内容脚本.md       # 多图阅读链路脚本
├── 配图提示词.json       # 每张图的生成提示词
└── 补图清单.md           # 图片未全量生成时必备
```

总表必须包含：

```text
04_publish_pack/publish_sheet.csv
```

并检查字段：

- `final_title` 不为空；
- `body` 不为空；
- `hashtags` 不为空；
- `image_folder` 指向实际目录；
- `image_generation_status` 为 `已生成` 或明确失败原因；
- 若不是 `已生成`，必须存在可执行补图清单、提示词路径和缺失图片编号；
- 不允许因真实采集失败、API Key 缺失或接口超时而让某篇完全没有配图脚本/提示词/占位目录；
- `risk_note` 说明版权/肖像/品牌/平台风险；
- `publish_status` 为 `可发布-待人工复核` 或 `需修改/需补图`。

## 9. 2026-04 灵性周边关键词任务沉淀

本轮用户连续修正了小红书图文交付标准，需要长期固化：

1. 用户说“图文”时，不要默认只做一张封面。小红书高收藏图文通常是多图阅读链路；对标样本几张图，二创尽量几张图。没有明确数量时，每篇默认 4-6 张，推荐 5 张。
2. 每篇小红书要单独一个小文件夹，方便用户直接复制发布。文件夹里至少包含：`正文_可直接复制.txt`、`话题.txt`、`图片内容脚本.md`、`配图提示词.json`、`配图/`。
3. 正文文件要干净，只保留用户发布时要复制的正文，不要混入执行说明、对标过程、提示词、生成状态。
4. 同一篇的多张图片要风格一致：同一配色、字体气质、边距、信息层级和视觉系统。
5. 图片不能只是氛围配图。小红书图文里图片承担主体阅读任务，要做成“图片即正文”的高收藏卡片：判断、清单、步骤、备忘录、速查表。
6. 图片上的文字不要出现生产标签或内部结构标签。禁止在最终图面上写：封面、对标卡、对比卡、痛点卡、方法卡、金句卡、备忘卡、内页、图1、图2。这些词只能出现在脚本、文件名或说明文档里。
7. 如果批量生图出现接口超时或部分失败，不要直接报告失败结束；应读取 manifest/error，补跑失败项，直到最终图片全量落盘或明确记录不可恢复原因。
8. 用户明确要求“做完再告诉我”时，不要中途输出半成品。先完成采集/兜底搜索、二创、文件夹整理、图片生成与校验，再一次性报告完成路径。

本轮实际输出目录示例：

```text
C:\Users\Lenovo\Desktop\小红书灵性周边关键词二创包
├── 05_按篇发布文件夹        # 每篇 4 张风格一致多图
└── 06_高收藏图文卡片版      # 每篇 5 张“图片即正文”卡片
```

高收藏图文卡片推荐结构：

1. 强钩子图：直接击中痛点或结果，不写“封面”。
2. 症状/判断图：让用户自我代入，不写“痛点卡”。
3. 方法/清单图：给 3-7 条可执行内容，不写“方法卡”。
4. 行动/总结图：给一句能保存/转发的收束，不写“金句卡”。
5. 速查/备忘图：做成清单或表格，不写“备忘卡”。

