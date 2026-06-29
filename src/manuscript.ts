// 四张手稿图工具：把长文本拆成 4 段并生成对应的手稿风格生图提示词。
//
// 拆分策略：
// 1. 规范化换行（\r\n → \n）并 trim 外层空白
// 2. 段数 >= 4：按段落贪心累积成 4 份
// 3. 段数 < 4：退化为按中文/英文句末标点切句，再贪心累积
// 4. 仍 < 4：在 25/50/75% 位置就近找边界（段落 > 句末标点 > 逗号/分号 > 空白 > 字符）做 4 等分
// 5. 校验：去除全部空白后，4 份拼接必须与原文完全一致（不丢字，不改字）

export type ManuscriptItemStatus =
  | "pending"
  | "generating"
  | "ready"
  | "inserted"
  | "error";

const SENTENCE_END = /[。！？!?；;]/;
const SENTENCE_SPLIT = /(?<=[。！？!?；;])\s*/;
const BOUNDARY_PUNCT = /[，、,]/;

/**
 * 把长文本固定拆成 4 个相对均衡、语义完整的片段。
 * 4 份拼接后（忽略空白）必须与原文一致。校验失败会抛错。
 */
export function splitContentIntoFourParts(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    throw new Error("请输入要生成图片的内容。");
  }

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean);

  let parts: string[];

  if (paragraphs.length >= 4) {
    parts = distributeUnitsIntoFour(paragraphs);
  } else {
    const sentences = paragraphs.flatMap(splitIntoSentences);
    if (sentences.length >= 4) {
      parts = distributeUnitsIntoFour(sentences);
    } else {
      parts = sliceTextIntoFour(normalized);
    }
  }

  validateParts(parts, normalized);
  return parts;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 贪心：尽量把每段总长压在 totalLen/4 附近，且不切断单元。
 *  关键约束：避免"最后一段虚胖" —— 当当前桶装到 target 附近时，如果"剩余字/剩余桶"
 *  仍显著大于 target（>1.35x），说明后面会被堆爆，主动多吞一个 unit，把负担前移。 */
function distributeUnitsIntoFour(units: string[]): string[] {
  if (units.length === 0) {
    return ["", "", "", ""];
  }

  const totalLen = units.reduce((sum, unit) => sum + unit.length, 0);
  const target = Math.max(1, Math.ceil(totalLen / 4));
  const OVERFLOW_TOLERANCE = 1.35; // 允许当前桶超出 target 多少倍，以减轻后续桶负担
  const parts: string[] = [];
  let current = "";
  let consumedLen = 0;

  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const remainingUnits = units.length - i;
    const remainingParts = 4 - parts.length;
    const remainingLenAfterThis = totalLen - consumedLen - unit.length;
    const bucketsLeftIfClose = remainingParts - 1;
    // 如果现在关桶，后面的平均每桶要装多少？
    const avgIfClose = bucketsLeftIfClose > 0 ? remainingLenAfterThis / bucketsLeftIfClose : 0;

    const overTarget = current.length > 0 && current.length + unit.length > target;
    const lastBucketWouldBloat = overTarget && avgIfClose > target * OVERFLOW_TOLERANCE;
    const mustClose =
      parts.length < 3 &&
      current.length > 0 &&
      (overTarget || remainingUnits <= remainingParts - 1) &&
      !lastBucketWouldBloat;

    if (mustClose) {
      parts.push(current);
      current = unit;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
    consumedLen += unit.length;
  }

  if (current) {
    parts.push(current);
  }

  while (parts.length < 4) {
    parts.push("");
  }

  if (parts.length > 4) {
    const extra = parts.splice(4);
    parts[3] = parts[3] ? `${parts[3]}\n\n${extra.join("\n\n")}` : extra.join("\n\n");
  }

  return parts;
}

/** 自然单元不足 4 时，按 25/50/75% 字符位置就近找边界硬切。 */
function sliceTextIntoFour(text: string): string[] {
  const total = text.length;
  if (total === 0) {
    return ["", "", "", ""];
  }

  const targets = [Math.round(total / 4), Math.round(total / 2), Math.round((total * 3) / 4)];
  const cuts: number[] = [];

  for (const target of targets) {
    cuts.push(findNearestBoundary(text, target, cuts));
  }

  const result: string[] = [];
  let prev = 0;
  for (const cut of cuts) {
    result.push(text.slice(prev, cut));
    prev = cut;
  }
  result.push(text.slice(prev));
  return result;
}

function findNearestBoundary(text: string, target: number, usedCuts: number[]): number {
  const total = text.length;
  const windowRadius = Math.max(8, Math.floor(total / 16));
  const lo = Math.max(1, target - windowRadius);
  const hi = Math.min(total - 1, target + windowRadius);

  const candidates: Array<{ index: number; priority: number; distance: number }> = [];

  for (let i = lo; i <= hi; i += 1) {
    const ch = text[i - 1];
    let priority = -1;
    if (ch === "\n") priority = 4;
    else if (SENTENCE_END.test(ch)) priority = 3;
    else if (BOUNDARY_PUNCT.test(ch)) priority = 2;
    else if (/\s/.test(ch)) priority = 1;

    if (priority >= 0 && !usedCuts.includes(i)) {
      candidates.push({ index: i, priority, distance: Math.abs(i - target) });
    }
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.distance - b.distance;
  });

  if (candidates.length > 0) {
    return candidates[0].index;
  }

  // 没有合适边界就退化到目标位置，但避开重复
  let fallback = target;
  while (usedCuts.includes(fallback) && fallback < total) {
    fallback += 1;
  }
  return Math.min(Math.max(1, fallback), total);
}

function validateParts(parts: string[], original: string): void {
  if (parts.length !== 4) {
    throw new Error("拆分结果数量不为 4，请检查输入内容。");
  }

  if (parts.every((part) => !part.trim())) {
    throw new Error("文本拆分后全部为空，请补充内容。");
  }

  const stripWhitespace = (text: string) => text.replace(/\s+/g, "");
  const joined = stripWhitespace(parts.join(""));
  const orig = stripWhitespace(original);

  if (joined !== orig) {
    throw new Error("拆分过程中文本发生丢失，请重试或调整内容。");
  }
}

// —— 生图提示词 ——

const MANUSCRIPT_STYLE_HINTS = [
  "像知识手写笔记。可加入简单手绘元素，例如人物、书桌、铅笔、橡皮、对话气泡、时钟。",
  "整体像课堂白板笔记或手写认知图。可加入简单手绘元素，例如放大镜、大脑、流程箭头、对话气泡、注意力图标。",
  "像知识卡片或方法图解。可加入简单手绘元素，例如人物动作、计时器、爱心、安静的环境、信任手势。整体排版要有层次，可以用箭头表示因果。",
  "像方法总结页。可加入简单手绘元素，例如三步清单、计时器、对比箭头、独立完成、成长的小树。",
];

/**
 * 根据拆分后的片段和顺序生成最终生图提示词，强制 9:16 手稿风格 + 原文逐字呈现。
 */
export function generateImagePrompt(partText: string, index: number): string {
  const style = MANUSCRIPT_STYLE_HINTS[index] ?? MANUSCRIPT_STYLE_HINTS[0];

  return `请生成一张9:16竖版手稿风格图片，背景必须是纯白色 #FFFFFF（与白色画布完全一致），没有任何纸张纹理、米色/奶白色底、边框、外框线、四角阴影、装饰花边或暗角，整张图四周直接是纯白底色，方便贴到白色白板上无缝衔接；黑色手写字体，排版清晰，${style}重点句可以用红色手写下划线、红色圈注或红色方框强调。

要求：以下文字必须全部、逐字、完整出现在图片中，不能删减，不能改写，不能遗漏任何标点。请优先保证文字完整和清晰可读，插图只能作为辅助，不能遮挡文字。

文字内容如下：

${partText}`;
}
