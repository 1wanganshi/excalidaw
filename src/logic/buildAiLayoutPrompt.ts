import type { LogicManuscriptIR } from "./types";
import { sentenceText } from "./splitSentences";

export function buildAiLayoutUserPrompt(ir: LogicManuscriptIR, intent?: string): string {
  const lines: string[] = [
    "<original>",
    ir.normalized,
    "</original>",
    "",
    "<sentences>",
  ];

  for (const s of ir.sentences) {
    const text = sentenceText(ir.normalized, s);
    lines.push(`${s.id}\t${s.role ?? "body"}\t${text}`);
  }
  lines.push("</sentences>");

  if (ir.chains.length > 0) {
    lines.push("", "<local_chains>");
    for (const c of ir.chains) {
      lines.push(`${c.kind}: ${c.sentenceIds.join(", ")}`);
    }
    lines.push("</local_chains>");
  }

  if (intent?.trim()) {
    lines.push("", `<intent>${intent.trim()}</intent>`);
  }

  lines.push(
    "",
    "请为以上句子输出布局 JSON：每个 pattern 只引用句子 ID（如 s0、s1），不要输出改写文字。",
    "要求：全部句子 ID 各出现恰好一次；overview 为装饰关键词（每词≤4字）；free_paragraph 占比≤40%。",
  );

  return lines.join("\n");
}

export function buildAiLayoutSystemPrompt(): string {
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
    `{`,
    `  "titleRef": "s0",`,
    `  "overview": ["词1","词2","词3"],`,
    `  "sections": [`,
    `    { "no": 1, "label": "章节名", "patterns": [ { "pattern": "scene_with_quotes", "sceneRefs": ["s0"], "quoteRefs": ["s2"] } ] }`,
    `  ]`,
    `}`,
    "",
    "自检：除 overview/triplet_circles.items/section.label 外，每个 sN 恰好出现一次。",
  ].join("\n");
}
