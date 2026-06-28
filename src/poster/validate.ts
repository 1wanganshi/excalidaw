import type { PosterDocument, PosterModule } from "../types";

const WHITESPACE_REGEX = /[\s\u3000\u200B\u200C\u200D\uFEFF]+/g;

export function normalizeText(text: string): string {
  return text.replace(WHITESPACE_REGEX, "");
}

export type CharDiff = {
  ok: boolean;
  missing: string[];
  extra: string[];
};

function toCharCount(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of text) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}

export function computeCharMultisetDiff(original: string, generated: string): CharDiff {
  const a = toCharCount(normalizeText(original));
  const b = toCharCount(normalizeText(generated));
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [ch, count] of a) {
    const diff = count - (b.get(ch) ?? 0);
    for (let i = 0; i < diff; i += 1) missing.push(ch);
  }
  for (const [ch, count] of b) {
    const diff = count - (a.get(ch) ?? 0);
    for (let i = 0; i < diff; i += 1) extra.push(ch);
  }
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/**
 * Collect ONLY the `source` field from each module. `source` is what the
 * module declares it covers from the original input. Decorative text in
 * title / section / overview labels does NOT participate in validation.
 */
export function collectDocumentText(doc: PosterDocument): string {
  let out = "";
  for (const m of doc.modules) {
    if (typeof (m as { source?: string }).source === "string") {
      out += (m as { source: string }).source;
    }
  }
  return out;
}

export function validatePoster(doc: PosterDocument, original: string): CharDiff {
  return computeCharMultisetDiff(original, collectDocumentText(doc));
}

function removeFirstOccurrence(text: string, ch: string): { text: string; removed: boolean } {
  const idx = text.indexOf(ch);
  if (idx < 0) return { text, removed: false };
  return { text: text.slice(0, idx) + text.slice(idx + 1), removed: true };
}

function stripExtraFromModule(m: PosterModule, extraCounts: Map<string, number>): PosterModule {
  if (m.kind === "title" || m.kind === "section" || m.kind === "overview") {
    // decorative modules: text/labels are not validated, but still strip from source field
    if ((m as { source?: string }).source) {
      let s = (m as { source: string }).source;
      for (const [ch, count] of Array.from(extraCounts.entries())) {
        let remaining = count;
        while (remaining > 0) {
          const r = removeFirstOccurrence(s, ch);
          if (r.removed) {
            s = r.text;
            remaining -= 1;
            extraCounts.set(ch, (extraCounts.get(ch) ?? 0) - 1);
          } else break;
        }
      }
      return { ...m, source: s } as PosterModule;
    }
    return m;
  }
  const next = { ...m } as PosterModule;
  const stripField = (field: string) => {
    // @ts-expect-error dynamic
    let val = next[field] as string | undefined;
    if (typeof val !== "string") return;
    for (const [ch, count] of Array.from(extraCounts.entries())) {
      let remaining = count;
      while (remaining > 0) {
        const r = removeFirstOccurrence(val!, ch);
        if (r.removed) {
          val = r.text;
          remaining -= 1;
          extraCounts.set(ch, (extraCounts.get(ch) ?? 0) - 1);
        } else break;
      }
    }
    // @ts-expect-error dynamic
    next[field] = val;
  };

  if (next.kind === "paragraph") stripField("text");
  if (next.kind === "highlight") stripField("text");
  if (next.kind === "case") stripField("text");
  if (next.kind === "summary") stripField("text");
  if (next.kind === "contrast") {
    stripField("wrong");
    stripField("right");
  }
  if (next.kind === "formula" || next.kind === "list") {
    // strip each item
    const items: string[] = Array.isArray(next.items) ? [...next.items] : [];
    for (let i = 0; i < items.length; i += 1) {
      let val = items[i];
      for (const [ch, count] of Array.from(extraCounts.entries())) {
        let remaining = count;
        while (remaining > 0) {
          const r = removeFirstOccurrence(val, ch);
          if (r.removed) {
            val = r.text;
            remaining -= 1;
            extraCounts.set(ch, (extraCounts.get(ch) ?? 0) - 1);
          } else break;
        }
      }
      items[i] = val;
    }
    next.items = items;
  }
  stripField("source");
  return next;
}

function splitOriginalIntoBlocks(original: string): string[] {
  const normalizedNewlines = original.replace(/\r\n/g, "\n");
  const blocks = normalizedNewlines
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => normalizeText(block).length > 0);
  if (blocks.length > 0) return blocks;
  const trimmed = normalizedNewlines.trim();
  return trimmed ? [trimmed] : [];
}

// ============================================================
// Atomic semantic tagging used by the local fallback classifier.
// 把一段话先抽成原子标签（negation/affirmation/enum/flow/...），再用组合判模块。
// 这样比一堆 OR regex 更准，也避免「不要 / 要」同时命中却只分到 highlight 的问题。
// ============================================================

type Atoms = {
  negation: boolean;
  affirmation: boolean;
  enumCount: number;
  flow: boolean;
  evidence: boolean;
  summary: boolean;
  definition: boolean;
};

const NEGATION_PATTERNS = /(不要|不是|别|错误|误区|错在|不能|不可)/;
const AFFIRMATION_PATTERNS = /(而是|应该|正确|才是|要做|需要|得|必须)/;
const FLOW_PATTERNS = /(→|->|⇒|然后|接着|第一|第二|第三|首先|其次|最后|步骤|流程|公式)/;
const EVIDENCE_PATTERNS = /(举个例子|举例|比如|例如|案例|以.+为例)/;
const SUMMARY_PATTERNS = /(总结|所以|最终|因此|结论|综上)/;
const DEFINITION_PATTERNS = /(是指|指的是|就是|意思是|定义为|即)/;
const ENUM_LINE_REGEX = /(?:^|\n)\s*(?:[0-9一二三四五六七八九十]+[.、)）]|[-•])\s*/g;

function tagAtoms(block: string): Atoms {
  const compact = block.replace(/\s+/g, "");
  const enumMatches = block.match(ENUM_LINE_REGEX);
  return {
    negation: NEGATION_PATTERNS.test(compact),
    affirmation: AFFIRMATION_PATTERNS.test(compact),
    enumCount: enumMatches ? enumMatches.length : 0,
    flow: FLOW_PATTERNS.test(compact),
    evidence: EVIDENCE_PATTERNS.test(block),
    summary: SUMMARY_PATTERNS.test(compact),
    definition: DEFINITION_PATTERNS.test(compact),
  };
}

/**
 * Try to extract a contrast (wrong / right) where BOTH halves are continuous
 * substrings of the original block. If anything is uncertain, return null so
 * the caller falls back to paragraph — we never silently rewrite original text.
 */
function tryExtractContrast(block: string): { wrong: string; right: string } | null {
  const negMatch = block.match(/(不要|不是|错误|误区|错在哪)[^，。；\n]+/);
  const affMatch = block.match(/(而是|应该|正确|才是|要做)[^，。；\n]+/);
  if (!negMatch || !affMatch) return null;
  const wrong = negMatch[0];
  const right = affMatch[0];
  if (!wrong || !right) return null;
  if (!block.includes(wrong) || !block.includes(right)) return null;
  // Make sure wrong sits before right in the original, otherwise it's not really
  // a "negation → affirmation" structure.
  if (block.indexOf(wrong) >= block.indexOf(right)) return null;
  return { wrong, right };
}

function extractEnumItems(block: string): string[] {
  const normalized = block.replace(/\r\n/g, "\n");
  const items = normalized
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[0-9一二三四五六七八九十]+[.、)）]|[-•])\s*/, "").trim())
    .filter((line) => line.length > 0);
  return items.length >= 2 ? items : [];
}

function extractFlowItems(block: string): string[] {
  const compact = block.replace(/\s+/g, "");
  if (/(→|->|⇒)/.test(compact)) {
    return compact.split(/→|->|⇒/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 24);
  }
  return [];
}

function localModuleForBlock(block: string, index: number, total: number): PosterModule {
  const atoms = tagAtoms(block);
  const compact = block.replace(/\s+/g, "");

  // 1) Summary anchors at the end of the article.
  if (index === total - 1 && atoms.summary) {
    return { kind: "summary", text: block, source: block };
  }

  // 2) Enumerated list — must have at least two numbered/bulleted lines.
  if (atoms.enumCount >= 2) {
    const items = extractEnumItems(block);
    if (items.length >= 2) {
      return { kind: "list", items, source: block };
    }
  }

  // 3) Negation + affirmation in the same block → contrast (only when both halves
  //    are real substrings of the original).
  if (atoms.negation && atoms.affirmation) {
    const pair = tryExtractContrast(block);
    if (pair) {
      return { kind: "contrast", wrong: pair.wrong, right: pair.right, source: block };
    }
  }

  // 4) Short formula-like block.
  if (atoms.flow && compact.length <= 90) {
    const items = extractFlowItems(block);
    if (items.length >= 2) {
      return { kind: "formula", items, source: block };
    }
  }

  // 5) Worked example block.
  if (atoms.evidence) {
    return { kind: "case", label: "举个例子", text: block, source: block };
  }

  // 6) Short definition or punch line → highlight.
  if (atoms.definition && compact.length <= 100) {
    return { kind: "highlight", text: block, source: block };
  }
  if (compact.length <= 60 && /(重点|关键|核心|记住|问题|痛点|方法|方案|结果|好处)/.test(compact)) {
    return { kind: "highlight", text: block, source: block };
  }

  return { kind: "paragraph", text: block, source: block };
}

function buildLosslessFallbackDocument(original: string, title: string): PosterDocument {
  const blocks = splitOriginalIntoBlocks(original);
  const firstLine = original.replace(/\r\n/g, "\n").split("\n").find((line) => line.trim().length > 0)?.trim() ?? "白板讲解长图";
  const modules: PosterModule[] = [
    { kind: "title", text: title || firstLine || "白板讲解长图", source: "" },
    { kind: "overview", items: ["原文", "结构", "重点", "总结"], source: "" },
    ...blocks.map((block, index) => localModuleForBlock(block, index, blocks.length)),
  ];
  return { title: title || firstLine, modules };
}

export function repairDocument(doc: PosterDocument, original: string): PosterDocument {
  const diff = validatePoster(doc, original);
  if (diff.ok) return doc;

  const fallback = buildLosslessFallbackDocument(original, doc.title);
  const recheck = validatePoster(fallback, original);
  if (recheck.ok) return fallback;

  // Last-resort fallback: one exact source module. This keeps character order intact.
  return {
    title: doc.title || "白板讲解长图",
    modules: [
      { kind: "title", text: doc.title || "白板讲解长图", source: "" },
      { kind: "paragraph", text: original, source: original },
    ],
  };
}

export function diffSummary(diff: CharDiff): string {
  const parts: string[] = [];
  if (diff.missing.length > 0) parts.push(`缺少 ${diff.missing.length} 个字符：${formatChars(diff.missing)}`);
  if (diff.extra.length > 0) parts.push(`多出 ${diff.extra.length} 个字符：${formatChars(diff.extra)}`);
  return parts.join(" / ");
}

function formatChars(chars: string[]): string {
  const counts = toCharCount(chars.join(""));
  const parts: string[] = [];
  for (const [ch, count] of counts) {
    const display = ch === "\n" ? "\\n" : ch;
    parts.push(count > 1 ? `${display}×${count}` : display);
  }
  return parts.join(" ");
}
