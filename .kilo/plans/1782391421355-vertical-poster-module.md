# AI 竖版内容图模块（取代「AI 生图表」）

> 计划已部分实现，本文件已更新为「断点续作版」，可直接交给实现 agent 接手。

## 目标

把现有「AI 生图表」整个功能改造为「AI 竖版内容图」：用户给一段原文，AI **不增不减** 地把它做成一张有设计感、宽度固定（720px）、高度可无限延伸的竖版长图，作为 Excalidraw 原生可编辑元素插入画布。

## 已确认设计决策

| 决策项 | 选择 |
| --- | --- |
| 功能归属 | Excalidaw 内新增模块，复用画布与 AI 设置 |
| 入口 | 「AI 生图表」tab 整体改造，不新增 tab、不动顶栏 |
| 技术路径 | AI 输出语义划块 JSON + 本地布局引擎渲染为 Excalidraw skeleton |
| 原文约束 | 零增零减；生成后做字符多重集比对校验 |
| 校验失败 | 自动重试 2 次（携带 missing/extra 差异），仍失败进入「人工补救」面板 |
| 布局 | 单列竖条，宽 720px，高度不限 |
| 设计感来源 | 内置 6 套主题预设：minimal-mono / soft-rednote / tech-dark / magazine / handwrite / literary-press |
| 字体 | 仅 Excalidraw 内置 fontFamily 枚举（1/2/3） |
| 语义块类型 | 8 种：cover / section / body / list-item / quote / kv / cta / footer |
| 输入 | 原文（必填）+ 可选意图提示 + 主题下拉 |
| 渲染结果 | 直接插入画布；底色用 rectangle 背景代替 frame，避免 0.18.1 frame skeleton 兼容性问题 |
| 后端通道 | 复用现有 `ai:generate-diagram` IPC；仅重写 system prompt 与返回 schema 为 `{ title, blocks }` |

## 已完成（已写入磁盘）

- `src/types.ts`
  - 新增 `PosterTheme`、`PosterBlockKind`、`PosterBlock`、`PosterDocument`、`PosterSkeleton`
  - `AiDiagramRequest.diagramKind: PosterTheme`
  - `AiDiagramResult: { title?: string; blocks: PosterBlock[] }`
  - 保留 `AiSettings.diagramPrompts` 字段以兼容旧 localStorage

- `src/electron.d.ts`
  - `AiDiagramResultPayload` 改为 `{ title?: string; blocks: PosterBlockPayload[] }`，并新增 `PosterBlockPayload` 类型

- `src/poster/themes.ts`
  - 常量：`POSTER_WIDTH = 720`、`POSTER_PADDING = 56`、`CONTENT_WIDTH = 608`
  - `ThemeSpec` 含主色/辅色/背景/strokeColor/fontFamily/roughness/8 种 kind 的 fontSize/cardRadius/blockGap/listMarker/decoration
  - 导出 `POSTER_THEMES: Record<PosterTheme, ThemeSpec>` 与 `POSTER_THEME_ORDER`
  - 6 套主题全部填充完成

- `src/poster/validate.ts`
  - `normalizeText`（去除 `\s`、`\u3000`、零宽字符）
  - `computeCharMultisetDiff(original, generated) -> { ok, missing, extra }`
  - `collectDocumentText(doc)`：把每个 block 的 `key + text` 顺序拼接（kv 的 key 也参与原文校验）
  - `validatePoster(doc, original)`
  - `repairDocument(doc, original)`：本地强制只用原文——按多重集差异先剔除 extra，再把 missing 追加到最后一个 body/footer 或新建 body 块
  - `diffSummary(diff)`

- `src/poster/layout.ts`
  - `renderPoster(doc, themeId, origin)` 返回 `ExcalidrawElementSkeleton[]`
  - 8 种 kind 全部实现：cover / section（带序号 + 装饰线）/ body / list-item（数字圆/圆点/方块/破折号四种 marker）/ quote（引号 + 主题色卡片）/ kv / cta（主题色填充反白大字）/ footer（顶部装饰线 + 居中小字）
  - 文本换行：CJK 按 fontSize、ASCII 按 fontSize\*0.56 估算字宽
  - 整张图底层是一个 rectangle 背景（顶替 frame skeleton），避免 0.18.1 兼容问题
  - 没有使用 frame/magicframe 类型

- `electron/main.ts`
  - `buildDiagramSystemPrompt` 重写为「切块助手」中文 system prompt，强调原文不增不减、`block.text` 必须是原文连续子串、所有 block.text 顺序拼接忽略空白后必须等于原文忽略空白后字符串；列出 8 种 kind 语义；解释 `<retry/>` 节如何修复；明确主题仅作语气参考、不影响切分
  - handler 改为校验 `Array.isArray(parsed.blocks)` 并返回 `{ title, blocks }`

## 未完成（实现 agent 接手必做）

### A. `src/App.tsx` 收尾

- 当前残留：临时占位类型 `MutableElementSkeleton`，需要删除
- 实现 `generateVerticalPoster`：
  1. 组装 user message：
     ```text
     <content>原文</content>
     <intent>可选意图</intent>
     ```
     重试时追加：
     ```text
     <retry missing="缺失字符序列" extra="多余字符序列">上次差异如上，请修正后重新输出</retry>
     ```
  2. 调 `window.excalidaw.generateAiDiagram({ model, prompt, diagramKind: theme })`
  3. `validatePoster(doc, original)`；不 ok 则带 diff 再调一次，最多重试 2 次（共 3 次请求）
  4. 仍失败：调 `onNeedRepair(doc, diff)`，让 panel 显示人工补救面板，不渲染
  5. 校验通过则渲染：
     - `renderPoster(doc, theme, origin)` 取得 skeleton 数组
     - `convertToExcalidrawElements(skeletons, { regenerateIds: true })`
     - 沿用现有流式插入节奏（首元素 80ms，之后 180ms / 元素较多时 80ms 也可）
     - `api.scrollToContent(elements, { fitToContent: true })`
     - `saveSnapshotToHistory(...)` 标题用 `doc.title || "竖版内容图"`
     - `persistDirty(true)`
- 把现有暴露给 `AiPanel` 的 `onGenerateDiagram` 改名/改签名为 `onGeneratePoster(request, onProgress, onNeedRepair)`，并暴露 `onAcceptRepair(doc, theme)` 给「强制只用原文」按钮调用（内部用 `repairDocument` 修复后走相同的渲染流程）

### B. `src/AiPanel.tsx` 收尾

- 移除 `diagramOptions`、`diagramKind`、`diagramUserRequirement` 旧字段与对应 UI
- 新增本地 state：
  - `posterTheme: PosterTheme`（默认 `minimal-mono`）
  - `posterOriginal: string`
  - `posterIntent: string`
  - `pendingRepair: { doc: PosterDocument; diff: CharDiff } | null`
- UI（`mode === "diagram"` 分支）：
  - 「设计主题」下拉，选项从 `POSTER_THEME_ORDER` + `POSTER_THEMES[id].label`
  - 「内容原文」textarea（大）
  - 「意图提示（可选）」textarea（小）
  - 「生成竖版内容图」按钮（沿用 `primary-button full-width-button`）
  - 进度区沿用 `progress` 列表
  - 当 `pendingRepair` 非空时显示人工补救面板：用 `diffSummary(diff)` 展示差异；两按钮「强制只用原文」/「取消」
- 不再调用 `saveImagePrompt` 类的逻辑

### C. `README.md` 一行改动

- 替换：「支持 AI 生图表，生成结果是可编辑的 Excalidraw 元素。」
- 替换为：「支持 AI 竖版内容图：粘贴原文 + 选主题，一键生成可编辑的竖版长图，原文零增零减。」

### D. 验证

1. `npx tsc --noEmit` 通过（关键：清除 App.tsx 占位类型后是否还有未使用 import）
2. `npm run build:electron` 通过
3. 手动用例（每个至少跑 1 套主题）：
   - 短宣言（约 80 字纯叙述）
   - 中等说明文（约 300 字含 3-5 项要点）
   - 长篇结构化笔记（约 1500 字含项目符号与引用）
   - 极端情况：原文含全角空格、零宽字符、英文混排
4. 6 套主题轮换：同一份输入跑 6 次，肉眼确认无重叠/溢出/风格差异
5. 校验失败路径：临时把模型 temperature 调高或在 prompt 后追加 "请压缩一下" 模拟漏字，确认重试与人工补救面板均能走通
6. 历史回滚：生成 2 次后从「历史生成」恢复早一次，确认所有元素正确还原

## 风险与对策

- **frame 兼容性**：已规避——整图底层用 rectangle 背景代替 frame
- **AI 偷偷压缩文本**：system prompt 已强约束 + 客户端兜底校验 + 重试 2 次 + 本地强制修复
- **中文全角半角差异**：normalize 去除所有空白但保留标点，标点差异会被识别
- **单 block 文本过长**：layout 已按字符宽度估算并自动 wrap
- **旧 localStorage**：`diagramPrompts` 字段保留为空，向后兼容
- **App.tsx 留有占位类型**：实现 agent 必须删除

## 关键代码位置

- 现有图表入口与流式插入：`src/App.tsx`（旧 `generateAiDiagram` 主体已部分删除，需在原位置写新版）
- 现有 AI 面板模式切换：`src/AiPanel.tsx:51-184`
- 已重写的 system prompt：`electron/main.ts:240-289` 附近
- IPC handler：`electron/main.ts:548-587`
- 新增本地模块：`src/poster/themes.ts`、`src/poster/layout.ts`、`src/poster/validate.ts`
