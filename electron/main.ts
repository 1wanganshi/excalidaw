import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let currentFilePath: string | null = null;
let isDirty = false;

const fileFilters = [
  { name: "Excalidraw", extensions: ["excalidraw", "json"] },
  { name: "All Files", extensions: ["*"] },
];

type AiModelConfig = {
  kind?: "image" | "language";
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageEndpoint: string;
  chatEndpoint: string;
  testEndpoint: string;
};

type AiImageRequest = {
  model: AiModelConfig;
  prompt: string;
  aspectRatio: "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "2:3" | "3:2";
  resolution: "1k" | "2k" | "4k";
};

type AiDiagramRequest = {
  model: AiModelConfig;
  prompt: string;
  diagramKind: string;
};

function joinApiUrl(baseUrl: string, endpoint: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

function getAuthHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function getImageSize(
  modelName: string,
  aspectRatio: AiImageRequest["aspectRatio"],
  resolution: AiImageRequest["resolution"],
) {
  const [widthRatio, heightRatio] = aspectRatio.split(":").map(Number);
  const normalizedModel = modelName.toLowerCase();

  void resolution;

  if (normalizedModel.includes("dall-e-2")) {
    return "1024x1024";
  }

  if (widthRatio === heightRatio) {
    return "1024x1024";
  }

  if (normalizedModel.includes("dall-e-3")) {
    return widthRatio > heightRatio ? "1792x1024" : "1024x1792";
  }

  return widthRatio > heightRatio ? "1536x1024" : "1024x1536";
}

function getImageQuality(modelName: string, resolution: AiImageRequest["resolution"]) {
  const normalizedModel = modelName.toLowerCase();

  if (normalizedModel.includes("dall-e-2")) {
    return null;
  }

  if (normalizedModel.includes("dall-e-3")) {
    return "standard";
  }

  if (resolution === "4k") {
    return "medium";
  }

  if (resolution === "2k") {
    return "medium";
  }

  return "low";
}

function buildImageRequestBody(
  modelName: string,
  prompt: string,
  size: string,
  resolution: AiImageRequest["resolution"],
  options: { includeQuality?: boolean } = {},
) {
  const normalizedModel = modelName.toLowerCase();
  const quality = getImageQuality(modelName, resolution);
  const includeQuality = options.includeQuality ?? true;
  const body: Record<string, unknown> = {
    model: modelName,
    prompt,
    n: 1,
    size,
  };

  if (includeQuality && quality) {
    body.quality = quality;
  }

  if (normalizedModel.includes("dall-e")) {
    body.response_format = "b64_json";
  }

  return body;
}

function shouldRetryImageGeneration(status: number) {
  return [400, 408, 422, 429, 500, 502, 503, 504].includes(status);
}

function getFallbackImageResolution(resolution: AiImageRequest["resolution"]): AiImageRequest["resolution"] {
  return resolution === "4k" ? "2k" : "1k";
}

type ImageGenerationAttempt = {
  label: string;
  size: string;
  resolution: AiImageRequest["resolution"];
  includeQuality: boolean;
};

function buildImageGenerationAttempts(
  size: string,
  resolution: AiImageRequest["resolution"],
): ImageGenerationAttempt[] {
  const fallbackResolution = getFallbackImageResolution(resolution);
  const attempts: ImageGenerationAttempt[] = [
    {
      label: `${size} + ${resolution.toUpperCase()}`,
      size,
      resolution,
      includeQuality: true,
    },
    {
      label: `${size} + no quality`,
      size,
      resolution: fallbackResolution,
      includeQuality: false,
    },
  ];

  if (size !== "1024x1024") {
    attempts.push({
      label: `1024x1024 + no quality`,
      size: "1024x1024",
      resolution: "1k",
      includeQuality: false,
    });
  }

  return attempts;
}

function buildImagePrompt(prompt: string, aspectRatio: AiImageRequest["aspectRatio"], resolution: AiImageRequest["resolution"]) {
  return [
    prompt.trim(),
    "",
    "Image generation requirements:",
    `- Aspect ratio: ${aspectRatio}.`,
    `- Target clarity: ${resolution.toUpperCase()}.`,
    "- Create a visually pleasing, polished image with strong design sense.",
    "- Use controlled color, clear contrast, and a strong focal point.",
    "- Make the subject easy to understand at a glance; avoid clutter and muddy colors.",
    "- Use harmonious composition, balanced negative space, and professional lighting or visual hierarchy when relevant.",
  ].join("\n");
}

function parseImageResponse(payload: any) {
  const firstImage = payload?.data?.[0] ?? payload?.images?.[0] ?? payload?.image ?? payload;
  const b64 = firstImage?.b64_json ?? firstImage?.base64 ?? firstImage?.image_base64;
  const url = firstImage?.url ?? payload?.url;

  if (typeof b64 === "string" && b64.length > 0) {
    const mimeType = firstImage?.mime_type ?? "image/png";
    return {
      dataUrl: b64.startsWith("data:") ? b64 : `data:${mimeType};base64,${b64}`,
      mimeType,
    };
  }

  if (typeof url === "string" && url.length > 0) {
    return {
      dataUrl: url,
      mimeType: "image/png",
    };
  }

  throw new Error("模型返回中没有找到图片数据。");
}

function extractTextResponse(payload: any) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.content;

  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? "").join("");
  }

  if (typeof content === "string") {
    return content;
  }

  throw new Error("语言模型返回中没有找到文本内容。");
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("语言模型没有返回 JSON。");
  }

  return JSON.parse(text.slice(start, end + 1));
}

/** 从用户组装提示词中提取原文内容（<content> 标签内） */
function extractContentFromPrompt(prompt: string): string {
  const match = prompt.match(/<content>\n?([\s\S]*?)\n?<\/content>/);
  return match ? match[1].trim() : prompt.trim();
}

/** 通用 LLM 调用（返回纯文本） */
async function callLlm(
  model: AiModelConfig,
  systemPrompt: string,
  userMessage: string,
  temperature = 0.2,
): Promise<string> {
  const response = await fetch(joinApiUrl(model.baseUrl, model.chatEndpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders(model.apiKey) },
    body: JSON.stringify({
      model: model.model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM 调用失败：HTTP ${response.status} ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  return extractTextResponse(payload);
}

/** 第一阶段：语义分析提示词 */
function buildSemanticAnalysisPrompt(): string {
  return [
    "你是一个文章语义分析器。分析以下文章的结构和语义，输出 JSON 分析报告。",
    "",
    "# 分析维度",
    "1. articleType —— 判断文章类型：",
    "   - tutorial: 教程/步骤/操作方法（有明确的步骤指引）",
    "   - argument: 议论文/观点文（有论点、论据、结论）",
    "   - explanation: 说明文/知识科普（解释概念、原理）",
    "   - comparison: 对比评测（对比不同事物优劣）",
    "   - narrative: 叙事/故事（有时间线的叙述）",
    "   - mixed: 混合类型",
    "",
    "2. keyConcepts —— 提取 3~8 个最核心的概念/术语",
    "",
    "3. importanceBySegment —— 给每个自然段打分 1~3：",
    "   - 3 = 核心论点/关键结论（必须突出展示）",
    "   - 2 = 重要论据/必要说明（正常展示）",
    "   - 1 = 次要细节/扩展信息（简洁展示即可）",
    "",
    "4. paragraphRelations —— 识别相邻段落间的语义关系：",
    "   - causes: 因果（因为A所以B）",
    "   - contrasts: 对比（A vs B / 不是A而是B）",
    "   - elaborates: 递进（进一步说明/详细展开）",
    "   - exampleOf: 举例（A，例如B）",
    "   - sequential: 顺序（第一步/第二步）",
    "   - none: 无特定关系",
    "",
    "5. suggestedVisualFlow —— 建议视觉组织方式：",
    "   - flow: 流程式（适合教程/步骤）",
    "   - tower: 宝塔式（适合议论文/总分总）",
    "   - split: 分栏式（适合对比）",
    "   - timeline: 时间线（适合叙事）",
    "   - default: 默认竖排（适合通用内容）",
    "",
    "# 输出格式",
    "必须为合法 JSON，不要 markdown 包裹，不要任何解释：",
    `{
  "articleType": "explanation",
  "keyConcepts": ["概念1", "概念2"],
  "importanceBySegment": [3, 2, 1],
  "paragraphRelations": [
    { "fromIndex": 0, "toIndex": 1, "relation": "elaborates" }
  ],
  "suggestedVisualFlow": "default",
  "totalParagraphs": 3
}`,
  ].join("\n");
}

/** 将语义分析结果格式化为 system prompt 插入段 */
function buildSemanticGuidance(rawJson: string): string[] {
  try {
    const a = JSON.parse(rawJson) as Record<string, unknown>;
    const lines: string[] = [
      "# 语义分析指导（已预先分析文章语义，请据此调整）",
      "",
      `文章类型：${a.articleType ?? "未知"}`,
      `建议视觉流程：${a.suggestedVisualFlow ?? "default"}`,
      `关键概念：${Array.isArray(a.keyConcepts) ? (a.keyConcepts as string[]).join("、") : "无"}`,
      "",
    ];

    const importance = a.importanceBySegment;
    if (Array.isArray(importance) && importance.length > 0) {
      lines.push(`段落重要性分段：${(importance as number[]).join(", ")}`);
      lines.push("（3=最核心 → 用 highlight 红框大字号突出；2=正常；1=次要 → 用 paragraph 简洁展示）");
      lines.push("");
    }

    const relations = a.paragraphRelations;
    if (Array.isArray(relations) && relations.length > 0) {
      lines.push("段落间关系：");
      for (const r of relations as Array<Record<string, unknown>>) {
        const from = (r.fromIndex as number) + 1;
        const to = (r.toIndex as number) + 1;
        lines.push(`  - 第${from}段 → 第${to}段：${r.relation}`);
      }
      lines.push("（contrasts → 必须用 contrast ✘✔ 模块；causes/sequential → 用 formula 流程框串联；exampleOf → 用 case 案例框）");
      lines.push("");
    }

    lines.push("### 每个模块必须添加 semantic 字段标注语义元信息：");
    lines.push('  "semantic": { "importance": 3, "relationToPrev": "elaborates", "relatedConcepts": ["概念1"] }');
    lines.push("- importance（1-3）：继承自段落重要性");
    lines.push("- relationToPrev：与前一模块的关系（causes/contrasts/elaborates/exampleOf/sequential/none）");
    lines.push("- relatedConcepts：该模块涉及的关键概念");
    lines.push("");

    return lines;
  } catch {
    return [];
  }
}

function buildDiagramSystemPrompt(diagramKind: string, analysisRaw?: string) {
  void extractContentFromPrompt;
  void callLlm;
  void buildSemanticAnalysisPrompt;
  const parts = [
    "你是把一篇文章转成「白板讲解型竖版长图」结构 JSON 的助手。客户端会用 Excalidraw 把每个模块画成白底黑字红重点的手绘风讲义：标题手绘下划线 + 圆圈总览 + 段落 + 红框重点 + ✘✔ 对错对比 + 公式流程框 + 案例框 + 编号列表 + 总结框。你只负责拆分原文 + 标注模块类型，绝不能改写原文。",
    "",
    "# 参考图制作方法",
    "画面要像老师在横向白板里边讲边画，不是传统海报：大标题先定主题；顶部/中部用『问题 + 解法 + 方案』圆圈总览；用粗箭头把问题、解法、案例、结论串起来；错误示范用红叉，正确做法用绿勾；公式要短、粗框、居中；案例用大圆角框承载；关键句用红框或红色手绘下划线。整体信息密度高，但每个模块必须留出安全边距，手机竖图里不允许文字贴边或出框。",
    "",
  ];

  // 如果有语义分析结果，插入指导
  if (analysisRaw) {
    const guidance = buildSemanticGuidance(analysisRaw);
    parts.push(...guidance);
  }

  parts.push(
    "# 硬约束（违反将判失败重试）",
    "1. 文章内容必须 100% 保留：所有承载原文的模块字段（paragraph.text、highlight.text、contrast.wrong、contrast.right、formula.items、case.text、list.items、summary.text）拼接起来，必须把原文每一个字都覆盖到。",
    "2. 每个承载原文的模块都必须填 `source` 字段，写明它从原文里覆盖了哪一段（必须是原文的连续子串，未做任何改写）。所有模块的 source 顺序拼接、去掉所有空白后，必须等于原文去掉空白后的字符串。",
    "3. 不允许改写、缩写、扩写、翻译、补字、去字、改标点。原文里有什么字，就保留什么字。",
    "4. 装饰性模块（title / section / overview）不消费原文：它们的 source 必须是空字符串 \"\"。这些模块的 text / items 可以是 AI 新增的小标题、章节标签、圆圈关键词，不计入原文校验。",
    "5. 收到 <retry/> 节附带的 missing / extra 字符列表时，按指示补回 missing、删除 extra 后重输出。",
    "",
    "# 思维图优先（重要）",
    "在拆分原文之前，请先在脑中画一张文章思维图：找出主题、3–5 个子主题、每个子主题下的关键短语。把这张思维图当作模块顺序的骨架。",
    "拆分时遵循三条规则：",
    "1) overview 圆圈词必须是短词（≤ 4 字），少而精，不要把段落塞进去。",
    "2) highlight 仅保留全文最重要的 1–3 句金句，每条 ≤ 30 字。模糊的、长段的说明 → 用 paragraph，让客户端按句拆。",
    "3) 不允许把一大段（> 80 字）的内容放在 highlight / formula / overview 这种「窄盒子」模块里 —— 一律改成 paragraph，客户端会自动按句拆成多条小卡片。",
    "",
    "# 模块类型与字段（每个模块的 kind 取下面之一）",
    "",
    "1) title（装饰，不消费原文）",
    '   { "kind": "title", "text": "整篇大标题", "source": "" }',
    "   - 全文最多 1 个，放在最前面。可以基于文章自动生成标题。",
    "",
    "2) section（装饰，不消费原文）",
    '   { "kind": "section", "text": "章节小标题", "source": "" }',
    "   - 用来在大块原文之间插入章节分隔。AI 自由命名。",
    "",
    "3) overview（装饰，不消费原文）",
    '   { "kind": "overview", "items": ["问题","解法","方案"], "source": "" }',
    "   - 顶部总览。3~6 个关键词圆圈，自动用箭头连成横向流程。",
    "",
    "4) paragraph（消费原文）",
    '   { "kind": "paragraph", "text": "<原文段落>", "source": "<同 text>" }',
    "   - 普通正文。text 与 source 一致，都是原文连续子串。",
    "",
    "5) highlight（消费原文，红色重点框）",
    '   { "kind": "highlight", "text": "<原文金句>", "source": "<同 text>" }',
    "   - 仅用于全文最关键的 1–3 句话（金句 / 定义 / 判断）。每条 ≤ 30 字。长段绝不要做 highlight，请改用 paragraph 让客户端按句拆开。",
    "",
    "6) contrast（消费原文，✘ ✔ 对错对比）",
    '   { "kind": "contrast", "wrong": "<原文错误项>", "right": "<原文正确项>", "source": "<wrong + right 顺序拼接>" }',
    "   - 用于「不要 X，要 Y」「不是 X，而是 Y」「错误 / 正确」结构。wrong 与 right 必须分别是原文里连续的子串。source 就是 wrong 字符串紧接 right 字符串。",
    "",
    "7) formula（消费原文，公式流程框）",
    '   { "kind": "formula", "items": ["错在哪","为什么","怎么做"], "source": "<items 顺序拼接>" }',
    "   - 用于步骤、公式、A→B→C 流程。每个 item 是原文里的一个短语。source 就是 items 拼接。",
    "",
    "8) case（消费原文，案例框）",
    '   { "kind": "case", "label": "举个例子", "text": "<原文案例段落>", "source": "<同 text>" }',
    "   - label 是装饰文字（如 举个例子 / 案例 / 比如），可省略。text 是原文里完整的案例段落。",
    "",
    "9) list（消费原文，编号列表）",
    '   { "kind": "list", "title": "三个好处", "items": ["...","...","..."], "source": "<items 顺序拼接>" }',
    "   - 文章里出现的编号列表、并列要点。title 是装饰，可省。items 每项必须是原文里的连续子串。source 就是 items 拼接。",
    "",
    "10) summary（消费原文，红框总结）",
    '    { "kind": "summary", "text": "<原文结论段落>", "source": "<同 text>" }',
    "    - 文章结尾的结论 / 总结。",
    "",
    "# 拆分原则",
    "- 文章从头到尾必须被「消费原文的模块」完整覆盖。每个字只能被覆盖一次，不能重复、不能漏。",
    "- 一段话如果有「对错」「不是…而是…」「不要…要…」结构 → 用 contrast。",
    "- 一段话如果有「公式」「步骤」「第一/第二/第三」「→」结构 → 用 formula。",
    "- 一段话如果是「举个例子 / 比如 / 案例」开头 → 用 case。",
    "- 一段话如果是「1. 2. 3.」或并列要点 → 用 list。",
    "- 一段话如果是关键定义、金句 → 用 highlight。",
    "- 文章结尾的结论 → 用 summary。",
    "- 其余正文用 paragraph。",
    "- 在合适的位置插入 section 分隔（装饰）和 overview（仅在文章开头插一个总览）。",
    "- 整篇模块数建议 8~30，太多会很乱、太少看不出结构。",
    "- 当你不确定要不要拆 contrast/formula 时，宁可用 paragraph 保留原文。",
    "",
    "# 切分示范（简版，仅作粒度参考）",
    "原文：『获客型短视频不是为了流量、爆款、涨粉、日更。问题：找痛点 ✘ 找极刚的痛点 ✔。极刚痛点：目标客户在做决策时，愿意付钱解决的问题。解法不是给标准答案，而是给思考路径。记住一个公式：错在哪 → 为什么 → 怎么做。三个好处：1、做悬念；2、筛客户；3、立权威。所以，获客视频是专业判断。』",
    "切法（不要照抄文字，只学切分粒度）：title / overview / paragraph / contrast(找痛点 vs 找极刚的痛点) / highlight(极刚痛点：...) / contrast(不是给标准答案 vs 而是给思考路径) / formula([错在哪, 为什么, 怎么做]) / list([做悬念, 筛客户, 立权威]) / summary。",
    "原则：原文里出现的标点、连接词、编号字符（如「问题：」「记住一个公式：」「1、」「。」），都要放进相邻模块的 source 中，不能丢字。",
    "",
    `# 主题`,
    `客户端选定主题：${diagramKind}（白板讲解风格，单一主题，不影响切分规则）。`,
    "",
    "# 输出格式",
    "必须为合法 JSON，不要 markdown 包裹，不要任何解释：",
    '{ "title": "可空字符串", "modules": [ {...}, {...}, ... ] }',
    "",
    "title 字段不参与原文校验，可与第一个 title 模块的 text 相同，也可为空。",
    "",
    "# 输出前自检",
    "把所有消费原文模块的 source 顺序拼接、去掉空白，再与原文去掉空白比较，必须完全一致。若不一致请重写。",
  );

  return parts.join("\n");
}

// ============================================================
// V2 prompt — "Section + Pattern" 模型
// 模型不再吐 10 种平铺 module，而是把整篇文章重组为 4–7 个 section，
// 每个 section 选一个 pattern。客户端按 pattern 选不同视觉。
// ============================================================

function buildDiagramSystemPromptV2(diagramKind: string): string {
  void diagramKind;
  return [
    "你把一篇文章重组为「白板长图」JSON：4–7 个 section，每个 section 选 1–3 个 pattern。",
    "",
    "# 硬约束",
    "1. 原文 100% 保留：每个 section.source 必须是原文连续子串，所有 source 去空白后拼接 = 原文去空白。",
    "2. 不改写、不缩写、不翻译、不补字、不去字、不改标点。",
    "3. 装饰字段（title / overview / label）不参与字符校验。",
    "",
    "# 10 个 pattern",
    'A. free_paragraph: { pattern, text, emphasis?: "normal"|"red" } 长解释段；红 emphasis 仅 ≤30 字短句。',
    'B. central_negation: { pattern, center, options: [≤6字] } 用于「X 不是为了 A/B/C/D」扇出+大红✘。',
    'C. triplet_circles: { pattern, items: [≤4字 × 2-4] } 用于「问题+解法+方案」并列短词。',
    'D. contrast_card: { pattern, wrong, right } 用于「不是 X 而是 Y / 不要 X 要 Y」；wrong/right 是原文连续子串。',
    'E. formula_chain: { pattern, items: [≤6字 × 2-4] } 用于「A → B → C」步骤/公式。',
    'F. triplet_list: { pattern, title?, items: [原文 × 2-5] } 用于「三个好处/三个原因/N 步」。',
    'G. scene_with_quotes: { pattern, scene, quotes: [短引语] } 用于场景叙述 + 内心独白/台词。',
    'H. case_box: { pattern, label?, punch?, wrong?, right?, quote?, body? } 用于「举个例子」嵌套。',
    'I. highlight: { pattern, text: ≤20字 } 全文 1–3 句金句。',
    'J. summary: { pattern, text: ≤60字 } 文末用 1 次。',
    "",
    "# 强制配额（很重要）",
    "全文必须包含：≥1 个 highlight；凡看到「不是 X 而是 Y」必用 contrast_card；凡看到 3 个以上并列短词必用 triplet_circles / triplet_list；凡看到「举个例子」必用 case_box；凡看到带引号的台词/独白必用 scene_with_quotes。free_paragraph 占比 ≤ 50%。",
    "",
    "# 输出（合法 JSON，无 markdown 包裹）",
    `{`,
    `  "title": "...",`,
    `  "overview": ["问题","解法","方案"],`,
    `  "sections": [`,
    `    { "no": 1, "label": "现象", "body": [ {...} ], "source": "<原文连续子串>" }`,
    `  ]`,
    `}`,
    "",
    "输出前自检：sections[].source 拼接 = 原文（去空白）。不一致请重写。",
  ].join("\n");
}

function updateTitle() {
  if (!mainWindow) {
    return;
  }

  const fileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : "Untitled";
  mainWindow.setTitle(`${isDirty ? "*" : ""}${fileName} - Excalidaw`);
}

function sendMenuCommand(command: string, payload?: unknown) {
  mainWindow?.webContents.send("menu-command", { command, payload });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "Excalidaw",
    backgroundColor: "#ffffff",
    icon: join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: join(__dirname, "../electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("close", (event: Electron.Event) => {
    if (!isDirty) {
      return;
    }

    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: "warning",
      buttons: ["Cancel", "Discard"],
      defaultId: 0,
      cancelId: 0,
      title: "Unsaved changes",
      message: "This drawing has unsaved changes.",
    });

    if (choice === 0) {
      event.preventDefault();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  updateTitle();
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand("new") },
        { label: "Open...", accelerator: "CmdOrCtrl+O", click: () => sendMenuCommand("open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendMenuCommand("save") },
        { label: "Save As...", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuCommand("save-as") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Excalidraw Project",
          click: () => shell.openExternal("https://github.com/excalidraw/excalidraw"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("scene:open", async () => {
  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Excalidraw file",
    filters: fileFilters,
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const filePath = result.filePaths[0];
  const contents = await readFile(filePath, "utf8");
  currentFilePath = filePath;
  isDirty = false;
  updateTitle();

  return { filePath, contents };
});

ipcMain.handle("scene:save", async (_event, sceneJson: string, saveAs: boolean) => {
  if (!mainWindow) {
    return null;
  }

  let filePath = currentFilePath;

  if (saveAs || !filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save Excalidraw file",
      defaultPath: currentFilePath ?? "Untitled.excalidraw",
      filters: fileFilters,
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    filePath = result.filePath;
  }

  await writeFile(filePath, sceneJson, "utf8");
  currentFilePath = filePath;
  isDirty = false;
  updateTitle();

  return { filePath };
});

ipcMain.handle("scene:set-dirty", (_event, nextDirty: boolean) => {
  isDirty = nextDirty;
  updateTitle();
});

ipcMain.handle("scene:set-clean-file", (_event, filePath: string | null) => {
  currentFilePath = filePath;
  isDirty = false;
  updateTitle();
});

ipcMain.handle("ai:test-model", async (_event, model: AiModelConfig) => {
  try {
    if (!model.baseUrl || !model.testEndpoint) {
      return { ok: false, message: "请填写 Base URL 和测试接口。" };
    }

    const response = await fetch(joinApiUrl(model.baseUrl, model.testEndpoint), {
      method: "GET",
      headers: {
        ...getAuthHeaders(model.apiKey),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        message: `测试失败：HTTP ${response.status} ${text.slice(0, 180)}`,
      };
    }

    return { ok: true, message: "连接成功。" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `测试失败：${error.message}` : "测试失败。",
    };
  }
});

ipcMain.handle("ai:generate-image", async (_event, request: AiImageRequest) => {
  const { model, prompt, aspectRatio = "1:1", resolution = "1k" } = request;

  if (!model.baseUrl || !model.imageEndpoint || !model.model || !prompt.trim()) {
    throw new Error("请填写生图模型配置、模型名和提示词。");
  }

  const size = getImageSize(model.model, aspectRatio, resolution);
  const finalPrompt = buildImagePrompt(prompt, aspectRatio, resolution);

  const url = joinApiUrl(model.baseUrl, model.imageEndpoint);
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeaders(model.apiKey),
  };
  const createImage = (attempt: ImageGenerationAttempt) =>
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(
        buildImageRequestBody(model.model, finalPrompt, attempt.size, attempt.resolution, {
          includeQuality: attempt.includeQuality,
        }),
      ),
    });
  const attempts = buildImageGenerationAttempts(size, resolution);
  const failures: string[] = [];

  for (const attempt of attempts) {
    const response = await createImage(attempt);

    if (response.ok) {
      const payload = await response.json();
      return parseImageResponse(payload);
    }

    const text = await response.text();
    failures.push(`${attempt.label}: HTTP ${response.status} ${text.slice(0, 140)}`);

    if (!shouldRetryImageGeneration(response.status)) {
      break;
    }
  }

  throw new Error(
    `生图失败：已自动尝试 ${attempts.length} 种兼容请求仍失败。请检查设置里的生图模型是否是真正的图片生成模型，生图接口通常应为 /images/generations。失败详情：${failures.join(" | ")}`,
  );
});

ipcMain.handle("ai:generate-diagram", async (_event, request: AiDiagramRequest) => {
  const { model, prompt, diagramKind } = request;

  if (!model.baseUrl || !model.chatEndpoint || !model.model || !prompt.trim()) {
    throw new Error("请填写语言模型配置、模型名和用户要求。");
  }

  // NOTE: 之前会先调一次语义分析、再调一次切分，导致总耗时翻倍，
  // 在 Cloudflare 这类网关下很容易踩到 100s 超时（524）。
  // 这一版只保留一次调用：直接做切分，语义分析后续作为可选项再加回。
  const systemPrompt = buildDiagramSystemPrompt(diagramKind);

  // 主动设 75s 超时：比 Cloudflare 的 100s 早一截断开，
  // 这样能返回明确的错误，而不是一坨 HTML 524 响应。
  const controller = new AbortController();
  const timeoutMs = 75_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(joinApiUrl(model.baseUrl, model.chatEndpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(model.apiKey),
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error(
        `模型 ${Math.round(timeoutMs / 1000)} 秒没有返回结果。原因可能是：1) 模型当前排队/超载，过一会儿重试；2) 文章太长，先拆短一点；3) 换一个更快的模型试试。`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 524 || response.status === 504 || response.status === 408) {
      throw new Error(
        `模型网关超时（HTTP ${response.status}）。这是模型那边响应太慢（不是你的网络）。建议：1) 稍后重试；2) 文章拆短；3) 换一个更快的模型。`,
      );
    }
    throw new Error(`图表生成失败：HTTP ${response.status} ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const parsed = extractJsonObject(extractTextResponse(payload));

  if (!Array.isArray(parsed.modules)) {
    throw new Error("语言模型返回的 JSON 缺少 modules 数组。");
  }

  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    modules: parsed.modules,
  };
});

// ============================================================
// Streaming variant: pushes each parsed module to the renderer
// as soon as it becomes parseable from the SSE token stream.
// IPC contract:
//   request  → invoke("ai:generate-diagram-stream", { request, streamId })
//   events   → "ai:diagram-stream:event" with { streamId, kind, ... }
//              kind = "title" | "module" | "done" | "error"
// The renderer subscribes via preload's onDiagramStreamEvent helper.
// ============================================================

type DiagramStreamPayload =
  | { streamId: string; kind: "title"; title: string }
  | { streamId: string; kind: "module"; module: unknown; index: number }
  | { streamId: string; kind: "done"; total: number }
  | { streamId: string; kind: "error"; message: string };

function pushStreamEvent(payload: DiagramStreamPayload) {
  if (!mainWindow) return;
  mainWindow.webContents.send("ai:diagram-stream:event", payload);
}

/**
 * Extract the first top-level balanced JSON object (or array) from `buf`,
 * starting at `from`. Returns the slice or null if nothing complete yet.
 */
function extractFirstBalanced(buf: string, from: number, open: "{" | "["): { text: string; endIndex: number } | null {
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = from; i < buf.length; i += 1) {
    const ch = buf[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === open) {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return { text: buf.slice(start, i + 1), endIndex: i + 1 };
      }
    }
  }
  return null;
}

/** Pull `"title": "..."` once, near the top of the JSON object. */
function tryExtractTitle(buf: string): string | null {
  const m = buf.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
  return m ? m[1].replace(/\\"/g, "\"") : null;
}

ipcMain.handle(
  "ai:generate-diagram-stream",
  async (
    _event,
    args: { request: AiDiagramRequest; streamId: string },
  ): Promise<{ ok: true; total: number } | { ok: false; message: string }> => {
    const { request, streamId } = args;
    const { model, prompt, diagramKind } = request;

    if (!model.baseUrl || !model.chatEndpoint || !model.model || !prompt.trim()) {
      const message = "请填写语言模型配置、模型名和用户要求。";
      pushStreamEvent({ streamId, kind: "error", message });
      return { ok: false, message };
    }

    const systemPrompt = buildDiagramSystemPrompt(diagramKind);
    const controller = new AbortController();
    const timeoutMs = 75_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(joinApiUrl(model.baseUrl, model.chatEndpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...getAuthHeaders(model.apiKey),
        },
        body: JSON.stringify({
          model: model.model,
          temperature: 0.2,
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const message =
        (err as { name?: string })?.name === "AbortError"
          ? `模型 ${Math.round(timeoutMs / 1000)} 秒没有返回结果。建议：1) 稍后重试；2) 文章拆短；3) 换更快的模型。`
          : (err as Error)?.message || "网络错误";
      pushStreamEvent({ streamId, kind: "error", message });
      return { ok: false, message };
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeoutId);
      const text = response.ok ? "" : await response.text().catch(() => "");
      const message =
        response.status === 524 || response.status === 504 || response.status === 408
          ? `模型网关超时（HTTP ${response.status}）。建议：1) 稍后重试；2) 文章拆短；3) 换更快的模型。`
          : `图表生成失败：HTTP ${response.status} ${text.slice(0, 240)}`;
      pushStreamEvent({ streamId, kind: "error", message });
      return { ok: false, message };
    }

    // Parse SSE: every line `data: {...}`; on each delta we accumulate into accumulatedText.
    let sseBuffer = "";
    let accumulatedText = "";
    let titleSent = false;
    let modulesArrayStart = -1;
    let scanCursor = 0; // index within `accumulatedText` where the next module is expected
    let moduleIndex = 0;

    const tryEmitModules = () => {
      if (modulesArrayStart < 0) {
        const arrIdx = accumulatedText.indexOf("\"modules\"");
        if (arrIdx < 0) return;
        // find the opening "[" of modules
        const openIdx = accumulatedText.indexOf("[", arrIdx);
        if (openIdx < 0) return;
        modulesArrayStart = openIdx + 1;
        scanCursor = modulesArrayStart;
      }
      while (true) {
        const found = extractFirstBalanced(accumulatedText, scanCursor, "{");
        if (!found) break;
        // Skip if there is a closing ']' before this object (i.e., the array ended).
        const arrEnd = accumulatedText.indexOf("]", scanCursor);
        if (arrEnd >= 0 && arrEnd < accumulatedText.indexOf("{", scanCursor)) break;

        try {
          const moduleObj = JSON.parse(found.text);
          pushStreamEvent({
            streamId,
            kind: "module",
            module: moduleObj,
            index: moduleIndex,
          });
          moduleIndex += 1;
        } catch {
          // Partial / not yet valid — wait for more data
          break;
        }
        scanCursor = found.endIndex;
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        let lineBreak = sseBuffer.indexOf("\n");
        while (lineBreak >= 0) {
          const line = sseBuffer.slice(0, lineBreak).trim();
          sseBuffer = sseBuffer.slice(lineBreak + 1);
          lineBreak = sseBuffer.indexOf("\n");
          if (!line || !line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          let chunk: { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
          if (typeof delta !== "string" || delta.length === 0) continue;
          accumulatedText += delta;

          if (!titleSent) {
            const t = tryExtractTitle(accumulatedText);
            if (t !== null) {
              titleSent = true;
              pushStreamEvent({ streamId, kind: "title", title: t });
            }
          }
          tryEmitModules();
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const message = (err as Error)?.message || "流式读取异常";
      pushStreamEvent({ streamId, kind: "error", message });
      return { ok: false, message };
    }
    clearTimeout(timeoutId);
    // Final pass — in case the buffer still has a tail module after stream end.
    tryEmitModules();
    pushStreamEvent({ streamId, kind: "done", total: moduleIndex });
    return { ok: true, total: moduleIndex };
  },
);

// ============================================================
// V2 streaming: emits section objects (with body[] of patterns) as they parse.
// 事件: title / overview / section / done / error
// ============================================================

type DiagramStreamV2Payload =
  | { streamId: string; kind: "title"; title: string }
  | { streamId: string; kind: "overview"; items: string[] }
  | { streamId: string; kind: "section"; section: unknown; index: number }
  | { streamId: string; kind: "done"; total: number }
  | { streamId: string; kind: "error"; message: string };

function pushStreamV2Event(payload: DiagramStreamV2Payload) {
  if (!mainWindow) return;
  mainWindow.webContents.send("ai:diagram-stream-v2:event", payload);
}

function tryExtractOverview(buf: string): string[] | null {
  const m = buf.match(/"overview"\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(`[${m[1]}]`);
    if (Array.isArray(arr) && arr.every((s) => typeof s === "string")) return arr;
  } catch {
    return null;
  }
  return null;
}

ipcMain.handle(
  "ai:generate-diagram-stream-v2",
  async (
    _event,
    args: { request: AiDiagramRequest; streamId: string },
  ): Promise<{ ok: true; total: number } | { ok: false; message: string }> => {
    const { request, streamId } = args;
    const { model, prompt, diagramKind } = request;

    if (!model.baseUrl || !model.chatEndpoint || !model.model || !prompt.trim()) {
      const message = "请填写语言模型配置、模型名和用户要求。";
      pushStreamV2Event({ streamId, kind: "error", message });
      return { ok: false, message };
    }

    const systemPrompt = buildDiagramSystemPromptV2(diagramKind);
    const controller = new AbortController();
    // V2 SSE 改用"空闲超时"：只要还在持续吐 token 就一直等，
    // 只有连续 60 秒没新数据才中断。否则 thinking 模型 / 长 prompt 经常
    // 在整体倒计时上被错误掐掉。
    const idleMs = 60_000;
    const initialMs = 75_000; // 首字节最长等 75 秒（开始的握手 + LLM thinking）
    let lastActivity = Date.now();
    let abortedReason: "idle" | "initial" | null = null;
    let firstTokenSeen = false;
    const watchdog = setInterval(() => {
      const elapsed = Date.now() - lastActivity;
      if (!firstTokenSeen && elapsed > initialMs) {
        abortedReason = "initial";
        controller.abort();
        clearInterval(watchdog);
      } else if (firstTokenSeen && elapsed > idleMs) {
        abortedReason = "idle";
        controller.abort();
        clearInterval(watchdog);
      }
    }, 1500);
    const clearWatchdog = () => clearInterval(watchdog);

    let response: Response;
    try {
      response = await fetch(joinApiUrl(model.baseUrl, model.chatEndpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...getAuthHeaders(model.apiKey),
        },
        body: JSON.stringify({
          model: model.model,
          temperature: 0.2,
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearWatchdog();
      const message =
        (err as { name?: string })?.name === "AbortError"
          ? abortedReason === "initial"
            ? `模型 ${Math.round(initialMs / 1000)} 秒没有开始返回。建议：1) 换更快的模型；2) 文章缩短。`
            : `模型流式被中断（空闲 ${Math.round(idleMs / 1000)} 秒无新数据）。`
          : (err as Error)?.message || "网络错误";
      pushStreamV2Event({ streamId, kind: "error", message });
      return { ok: false, message };
    }

    if (!response.ok || !response.body) {
      clearWatchdog();
      const text = response.ok ? "" : await response.text().catch(() => "");
      const message =
        response.status === 524 || response.status === 504 || response.status === 408
          ? `模型网关超时（HTTP ${response.status}）。建议：1) 稍后重试；2) 文章拆短；3) 换更快的模型。`
          : `图表生成失败：HTTP ${response.status} ${text.slice(0, 240)}`;
      pushStreamV2Event({ streamId, kind: "error", message });
      return { ok: false, message };
    }

    let sseBuffer = "";
    let accumulatedText = "";
    let titleSent = false;
    let overviewSent = false;
    let sectionsArrayStart = -1;
    let scanCursor = 0;
    let sectionIndex = 0;

    const tryEmitSections = () => {
      if (sectionsArrayStart < 0) {
        const arrIdx = accumulatedText.indexOf("\"sections\"");
        if (arrIdx < 0) return;
        const openIdx = accumulatedText.indexOf("[", arrIdx);
        if (openIdx < 0) return;
        sectionsArrayStart = openIdx + 1;
        scanCursor = sectionsArrayStart;
      }
      while (true) {
        const found = extractFirstBalanced(accumulatedText, scanCursor, "{");
        if (!found) break;
        const arrEnd = accumulatedText.indexOf("]", scanCursor);
        if (arrEnd >= 0 && arrEnd < accumulatedText.indexOf("{", scanCursor)) break;
        try {
          const sectionObj = JSON.parse(found.text);
          pushStreamV2Event({
            streamId,
            kind: "section",
            section: sectionObj,
            index: sectionIndex,
          });
          sectionIndex += 1;
        } catch {
          break;
        }
        scanCursor = found.endIndex;
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lastActivity = Date.now();
        firstTokenSeen = true;
        sseBuffer += decoder.decode(value, { stream: true });

        let lineBreak = sseBuffer.indexOf("\n");
        while (lineBreak >= 0) {
          const line = sseBuffer.slice(0, lineBreak).trim();
          sseBuffer = sseBuffer.slice(lineBreak + 1);
          lineBreak = sseBuffer.indexOf("\n");
          if (!line || !line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          let chunk: { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
          if (typeof delta !== "string" || delta.length === 0) continue;
          accumulatedText += delta;

          if (!titleSent) {
            const t = tryExtractTitle(accumulatedText);
            if (t !== null) {
              titleSent = true;
              pushStreamV2Event({ streamId, kind: "title", title: t });
            }
          }
          if (!overviewSent) {
            const ov = tryExtractOverview(accumulatedText);
            if (ov && ov.length > 0) {
              overviewSent = true;
              pushStreamV2Event({ streamId, kind: "overview", items: ov });
            }
          }
          tryEmitSections();
        }
      }
    } catch (err) {
      clearWatchdog();
      const message =
        (err as { name?: string })?.name === "AbortError"
          ? abortedReason === "initial"
            ? `模型 ${Math.round(initialMs / 1000)} 秒没有开始返回。建议：1) 换更快的模型；2) 文章缩短。`
            : abortedReason === "idle"
              ? `模型流式被中断（空闲 ${Math.round(idleMs / 1000)} 秒无新数据）。`
              : "流式被取消"
          : (err as Error)?.message || "流式读取异常";
      pushStreamV2Event({ streamId, kind: "error", message });
      return { ok: false, message };
    }
    clearWatchdog();
    tryEmitSections();
    pushStreamV2Event({ streamId, kind: "done", total: sectionIndex });
    return { ok: true, total: sectionIndex };
  },
);

// ============================================================
// 手稿绘图 AI 布局：只输出句子 ID 引用 + pattern 选择，不改写原文
// ============================================================

function buildLogicLayoutSystemPrompt(): string {
  return [
    "你是「手稿白板布局导演」：读者给你已切分的句子列表（s0、s1…）和本地逻辑链提示。",
    "你的任务 ONLY：决定章节划分 + 每个区块用哪种 visual pattern + 引用哪些句子 ID。",
    "你不写字、不改写、不缩写——所有展示文字由客户端从句子 ID 注入。",
    "",
    "# 10 种 pattern（refs 均为句子 ID）",
    '1. scene_with_quotes: { pattern, sceneRefs: [s?], quoteRefs: [s?] } — 引子/场景+台词',
    '2. highlight: { pattern, ref: "s?" } — 概念金句、带引号短句（≤36字）',
    '3. triplet_list: { pattern, titleRef?: "s?", refs: [s?,s?,s?] } — 第一/二/三列举、多步清单',
    '4. contrast_card: { pattern, ref: "s?" } — 含「不要…改成…」的对比句',
    '5. formula_chain: { pattern, ref: "s?" } — 含 → 的公式/机制链',
    '6. case_box: { pattern, refs: [s?,…] } — 步骤方案块（含第X步开头句）',
    '7. free_paragraph: { pattern, refs: [s?,…], emphasis?: "red" } — 叙述段；仅合并相邻叙述句',
    '8. summary: { pattern, ref: "s?" } — 文末结论',
    '9. central_negation: { pattern, center: "≤8字", refs: [s?,…] } — 核心词+扇出否定（少用）',
    '10. triplet_circles: { pattern, items: ["≤4字",…] } — 顶部概览圆（2–3个装饰词，非句子ID）',
    "",
    "# 章节结构",
    "- 4–7 个 section，每节 1–3 个 pattern",
    "- 引子（前 2–4 句）→ scene_with_quotes",
    "- 机制讲解 → highlight + triplet_list + free_paragraph",
    "- 三步方案 → 3 个 case_box（各引用一步的全部句子）",
    "- 对比句必须用 contrast_card，公式链用 formula_chain",
    "",
    "# 输出 JSON（无 markdown）",
    `{ "titleRef": "s0", "overview": ["词1","词2","词3"], "sections": [ { "no": 1, "label": "章节名", "patterns": [] } ] }`,
    "",
    "自检：除 overview/triplet_circles.items/section.label 外，每个 sN 恰好出现一次。",
  ].join("\n");
}

ipcMain.handle("ai:generate-logic-layout", async (_event, request: AiDiagramRequest) => {
  const { model, prompt } = request;

  if (!model.baseUrl || !model.chatEndpoint || !model.model || !prompt.trim()) {
    throw new Error("请填写语言模型配置并粘贴原文。");
  }

  const systemPrompt = buildLogicLayoutSystemPrompt();
  const controller = new AbortController();
  const timeoutMs = 90_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(joinApiUrl(model.baseUrl, model.chatEndpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(model.apiKey),
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0.15,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error(`AI 布局分析超时（${Math.round(timeoutMs / 1000)} 秒），将使用本地布局。`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 布局分析失败：HTTP ${response.status} ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const parsed = extractJsonObject(extractTextResponse(payload));

  if (!Array.isArray(parsed.sections)) {
    throw new Error("AI 返回的 JSON 缺少 sections 数组。");
  }

  return parsed;
});

app.whenReady().then(async () => {
  createMenu();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
