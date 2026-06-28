# Changelog

## 0.2.23 - 2026-06-28

- 手稿绘图：新增 **AI 辅助布局**（混合模式）— 本地切句保原文，语言模型只输出句子 ID + pattern 计划，客户端注入文字并用 layoutV2 渲染；失败自动回退规则布局。

## 0.2.22 - 2026-06-28

- 手稿绘图讲义长图：Logic IR 桥接 `layoutV2` pattern 渲染（scene/contrast/case_box/triplet_list/formula_chain 等），替代纯竖排堆字；消除句间乱箭。

## 0.2.21 - 2026-06-28

- 手稿绘图：开头引子独立黄框、第一/二/三列举拆行+箭头、对比句 ✘✓ 左右分列。

## 0.2.20 - 2026-06-28

- 手稿绘图：修复引号内误切句、步骤块分组、章节/问答识别与布局（红框步骤、段间分隔线、公式链、对比 ✘✓）。

## 0.2.19 - 2026-06-28

- 落地「手稿绘图」方法论 v1.0：本地按句子切分原文，识别逻辑链路与条件箭头，无需语言模型。
- 双导出：讲义长图（整句 + 箭头）与逻辑导图（关键词链 + 箭头）。
- 新增 `src/logic/*` 模块与 `docs/manuscript-methodology.md`。
- AI 助手新增「手稿绘图」入口。

## 0.2.18 - 2026-06-26

- 修复忠实模式 toggle 的 UI 显示：之前 `.panel-section label { display: grid }` 把 flex 子元素压成竖条，文字被挤成一列窄字。改用独立 CSS class（`.fidelity-toggle-row` + `.fidelity-toggle-desc`），勾选框 + 标题正常横排，描述文字另起一行。

## 0.2.17 - 2026-06-26

- 新增「忠实模式」开关：跳过 AI，直接把整篇原文渲染为竖排纯文本。零字差，零模型介入，但没有圆圈、对比卡、公式链等视觉模块。当你对原文完整度有强要求时打开。
- 默认仍是「精美模式」（AI 视觉化），不影响现有用法。

## 0.2.16 - 2026-06-26

- **回滚到 0.2.11 的渲染行为**：取消"严格校验 + 自动补齐"。模型给什么就画什么 —— 不再让校验/兜底代码污染画面。
- 删除 strictValidate.ts；App.tsx 改回"边收边画"流式；layoutV2 移除"补齐 section"特殊视觉。
- 原文覆盖度只作警告：流式结束后在进度条显示"原文覆盖 N%"，让用户知情但不动数据。
- 保留 0.2.14 的引号修复（scene_with_quotes 自动补一对中文双引号，避免画面孤儿引号）。

## 0.2.15 - 2026-06-26

- 漏字补齐从「全部塞最后一节末尾」改成「按位置插入到对应 section 之间」。算法：根据每个 chunk 在原文里的 origStart 折算 gen-空间位置，找到对应的 section 边界。
- 漏字补齐 section 视觉差异化：左侧 6px 灰色竖线 + 顶部小灰「补」徽章，字号比正文小一号，整体偏灰。这样一眼能看出"哪些是 AI 漏字被自动补回来的"。

## 0.2.14 - 2026-06-26

通过本地脚本 `scripts/test-strict-validate.ts` 跑了 5 组 case 后修复：

- 修复 scene_with_quotes 引号丢失误判：模型给 quotes 时通常会脱掉外层引号（"快点写！" → 快点写！），导致原文里的引号被校验判为"漏字"，最后会出现一堆孤立的 `"` 追加到末尾。
- 修法：渲染端和 strictValidate 一致地"自动补一对中文双引号"。如果 quote 已带引号则保留，否则补 `"…"`。这样原文 100% 不丢，画面也不会出现孤儿引号。

## 0.2.13 - 2026-06-26

- 修复 0.2.12 的过度兜底：校验失败时不再把整篇原文塞进第一节、掏空其他章节。
- 改成「按顺序子序列校验 + 末尾补齐」：
  - 模型只是漏字（顺序正确）→ 把漏的字符按段追加到末尾的 free_paragraph，保留所有已生成的视觉模块。
  - 模型乱改原文（字符不在原文里 / 顺序错了）→ 才走整篇兜底。
- triplet_circles.items / central_negation.options / center 也计入校验（这些字段经常直接拷原文短词）。

## 0.2.12 - 2026-06-26

- **严格原文校验**：流式收齐 → 字符级 + 顺序级校验 → 通过才一次性渲染。
- 校验不再依赖模型自己声明的 `source` 字段，而是把 body 里所有承载原文的字段（free_paragraph.text、contrast_card.wrong/right、formula_chain.items、case_box.* 等）按渲染顺序拼起来，跟原文做精确比对。任何字符替换、顺序错乱、改标点、缩写都会被抓到。
- 校验失败时自动用「整篇原文兜底」（一个 free_paragraph 装整篇原文），保证零字差。UI 上明示「模型输出与原文不一致，已自动用原文兜底」。
- 渲染节奏改成"收齐后按 80ms 间隔一节节呈现"，仍保留视觉流动感。

## 0.2.11 - 2026-06-26

- **修复 V2 流式被无端 abort**：把"整体 90s 超时"改成"空闲 60s + 首字节 75s"双层 watchdog。每收到一次 SSE 数据就重置计时器，模型只要在持续吐 token 就一直等。
- **V2 提示词大瘦身**：从 ~3000 token 砍到 ~900 token，去掉大量重复说明和示例，让模型首字节延迟更短。
- **前端心跳提示**：等待模型首字节时，UI 每 3 秒显示一次"等待模型首字节（已等 Ns，最长 75s）"，不再让用户看着空白发懵。

## 0.2.10 - 2026-06-26

- **删掉徽章美学**：章节标题从「红色 01 + 双下划线徽章」改成「一、章节名：」+ 章节名底下一根细红下划线 —— 回归参考图那种手稿质感，不再像海报。
- **highlight 改为手稿"重点划"**：去掉大红圆角框，整段红字 → 黑字 + 句下细红下划线 + 句末小红圈，参考图大量在用。
- **summary 也改手稿**：去掉「总结」chip + 大红框，改成「记住：xxx」前缀 + 结论句下方一根粗红双划线。
- **scene_with_quotes 引号修正**：把模型乱给的 `"` `"` 引号统一剥掉，重新只在外面包一对中文「」，避免引号被切到下一行成孤儿。
- **提示词加硬性配额**：1) 至少 1 个 highlight；2) 凡是「不是 X 而是 Y / 三个 X / 举个例子 / 引号台词」必须用对应 pattern，不允许塞进 free_paragraph；3) free_paragraph 占比 > 70% 时客户端给出"偏单调"提示。
- **提示词反例清单**：列出 5 个常见误用，让模型直接看见什么是错的。

## 0.2.9 - 2026-06-26

- **修复 highlight / summary / 圆圈 / 公式框的文字飘出框外**：放弃 Excalidraw 的 `textAlign:center`（它会按文字实宽收缩 width 再居中，结果整段贴左溢出），改成手算 x 让 text 元素左上角落在视觉正确的位置。
- 大标题改为真正居中（红下划线和标题同轴）。
- free_paragraph 长段（> 60 字）自动按中文句末标点拆成多个分句，每句独立成段。
- wrap 增加中文标点禁开禁尾：「。」「，」「？」不再孤悬到行首；「「」「（」不再挤到行尾。
- 同一 section 里：当 triplet_list 的 title 与 section.label 重复时，自动隐藏内部小标题。
- 提示词强化：highlight ≤ 30 字、每章至多 1 个 highlight；summary ≤ 60 字；triplet_list.title 不允许与 section.label 重复。

## 0.2.8 - 2026-06-26

- **换底**：把渲染哲学从"10 种模块平铺 + 每段一标 ▸ + 每两段一根 ↓"改成"4–7 个章节，每章选一个 pattern"。
- 新增 10 种 pattern：`free_paragraph` / `central_negation` / `triplet_circles` / `contrast_card` / `formula_chain` / `triplet_list` / `scene_with_quotes` / `case_box` / `highlight` / `summary`，每种 pattern 有自己的视觉，整张图不再是一种节奏。
- 新增 V2 SSE 流式接口（`ai:generate-diagram-stream-v2`）：模型按章节吐出，前端按章节即时画。每章带"01 / 02 / …"编号 + 章节小标题 + 双红下划线。
- 章节之间用大留白做分隔，**取消模块间默认 ↓**。只有 contrast / formula / central_negation 内部才有真正的箭头。
- `case_box` 是嵌套容器：内部可同时含 punch / wrong / right / quote / body。
- 长解释段一律走 `free_paragraph`：纯文字、无 ▸、无外壳。
- 提示词重写：让模型先做"思维图"决策，再选 pattern。

## 0.2.7 - 2026-06-26

- 删除白色背景大框：参考图是"散点白板"而不是"文档页面"，这块大框反而把字框出去。
- 修复 valign:middle 文字飘出框外的回退问题：圆圈/胶囊/highlight/公式/案例/总结的标签文字改成"手动算 y 居中"，文字真正落在框里。
- 长段（> 60 字）现在自动按句拆分成多条带 ▸ 的小卡片，左侧用一根细竖线串起来，文字不再被困在一个小框里冒字。
- 模块之间默认补一根灰色细短箭头作为"接着讲"的视觉串联，整张图更像思维导图。
- 关键词下划线改为必须独立成词（前后是标点/空白）才匹配，避免"胜任感"里的"任感"被错误划线。
- 提示词新增"思维图优先"段：让模型先在脑中规划骨架，highlight 限 ≤ 30 字，长段一律用 paragraph 让客户端按句拆。

## 0.2.6 - 2026-06-26

- Overview now auto-picks between big-circle + plus (for 2–3 short labels) and pill + arrow flow (for longer/more items) so the opening of the poster matches the whiteboard reference instead of always forcing oversized circles.
- Highlight / formula / case / summary / overview labels are now vertically centered via Excalidraw's own text valign, removing the small text-vs-frame offset.
- Paragraph blocks add a red ▸ bullet and an optional red side rule so the middle of the long image is no longer a flat wall of text.
- Highlight box now has a thin red underline accent.

## 0.2.5 - 2026-06-26

- True end-to-end streaming for the whiteboard long image: SSE from the LLM is parsed module-by-module on the main process, and each module is drawn onto the Excalidraw canvas the moment it becomes valid JSON.
- Removed the previous fake `setTimeout` pacing; first visible content arrives within the first second of model response.
- Added `renderSingleModule` so layout work happens per module without recomputing the whole document.
- Progress now shows live counts and an elapsed-seconds counter.

## 0.2.4 - 2026-06-26

- Added a 75s client-side timeout for the diagram LLM call so Cloudflare 524 / gateway HTML errors are replaced by a clear, actionable Chinese message.
- Skipped the second semantic-analysis LLM call to roughly halve total request time and dodge gateway timeouts.
- Slimmed the diagram system prompt: kept the splitting cue but removed the verbose worked example so the request body and model latency are smaller.

## 0.2.3 - 2026-06-26

- Added a worked切分例子 to the diagram system prompt so the language model copies the exact splitting granularity used by the whiteboard references.
- Rewrote the local fallback classifier into an atomic tagger: each block is first tagged with negation / affirmation / enum / flow / evidence / summary / definition, then routed to contrast / list / formula / case / highlight / paragraph based on combinations.
- Strict contrast extraction now requires both halves to be exact substrings of the source and to appear in negation→affirmation order, otherwise the block falls back to paragraph (never silently rewriting original text).

## 0.2.2 - 2026-06-26

- Learned from the provided whiteboard reference frames: overview now uses circle + plus composition, contrast cards use heavier rounded outlines, and body modules add stronger teaching-style emphasis.
- Improved method/formula/list rendering to look more like a spoken whiteboard lesson: short formula chips, bold numbered takeaways, red underline cues, and safer staggered text blocks.
- Strengthened the diagram system prompt with explicit reference-image production rules.

## 0.2.1 - 2026-06-26

- Tightened poster text measurement and wrapping to reduce overflow in the vertical whiteboard long image.
- Added stronger fallback packing for long labels, keyword emphasis, and case/list rendering so the layout reads more like a teaching whiteboard.
- Updated the AI diagram entry label to "AI白板长图".
- Bumped the release version for the poster layout follow-up.

## 0.2.0 - 2026-06-26

- Replaced "AI 生图表" with "AI 白板讲解长图"：粘整篇文章，自动生成竖版白板讲义风长图。
- 严格保留原文 100% 不删；字符多重集校验，自动重试 + 人工补救面板。
- 新增 10 种白板模块：title / section / overview / paragraph / highlight / contrast / formula / case / list / summary。
- 白底黑字 + 红色重点框 + 红色下划线 + ✘✔ 对错符号 + 绿色正确提示 + 手绘箭头 / 圆圈 / 圆角框。
- 1080px 宽，高度按内容动态延展，最小 1920px。
- 流式输出按模块分阶段呈现，每个模块画完后短暂停顿。
- 所有元素均为 Excalidraw 原生元素，可拖动、改色、编辑、删除。
- 修复 Node 24 + Electron 42 启动失败问题（电子主进程改为 CommonJS 输出 + 启动器移除 ELECTRON_RUN_AS_NODE）。

## 0.1.1 - 2026-06-09

- Added New Page and Generation History actions to the desktop toolbar.
- Added local history restore for previously generated canvases.
- Fixed native diagram generation crashes caused by incomplete AI text fields.
- Fixed disconnected diagram connectors by normalizing bound arrow geometry.
- Improved the native diagram system prompt for simpler, more spacious, and clearer visual hierarchy.
- Rebuilt the Windows portable release package.

## 0.1.0 - 2026-06-08

- Initial public release.
- Added Windows desktop packaging.
- Added AI image generation with aspect ratio and clarity controls.
- Added automatic canvas placement for generated images.
- Added editable native diagram generation powered by language models.
- Added model settings for image and language models.
