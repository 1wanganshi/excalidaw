import type { LogicChain, LogicEdge, LogicEmphasis, LogicSentence, SentenceRole, EdgeRelation } from "./types";
import { sentenceText } from "./splitSentences";

const STEP_START = /^第[一二三四五六七八九十\d]+步[，,：:\s]/;
const SECTION_START =
  /^我们来拆解|^那怎么破局|^试试这样做|^你会发现，|^因为分数的本质|^道德经里|^道德经说|^心理学有一个概念/;

function isStepLine(text: string): boolean {
  const t = text.trim();
  return /^Step\s*\d/i.test(t) || STEP_START.test(t) || /^[①②③④⑤⑥⑦⑧⑨]/.test(t);
}

function isSectionLine(text: string): boolean {
  const t = text.trim();
  if (STEP_START.test(t)) return false;
  if (isRhetoricalHook(t)) return false;
  if (t.length <= 18 && /[？?]$/.test(t) && /^(怎么|为什么|那怎么)/.test(t)) return true;
  return SECTION_START.test(t) || /^我们来拆解/.test(t) || /^那怎么破局/.test(t);
}

function isContrastPair(fromText: string, toText: string): boolean {
  if (/不要|不是|别指望|不是靠|别讲|不要去/.test(fromText) && /你就|而是|应该|改成|要/.test(toText)) {
    return true;
  }
  if (fromText.includes("❌") || fromText.includes("✘")) return true;
  return false;
}

function isRhetoricalHook(text: string): boolean {
  return /你.*什么|有没有发现|第一反应|越.*越/.test(text);
}

export function assignSentenceRoles(sentences: LogicSentence[], normalized: string): void {
  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i];
    const text = sentenceText(normalized, s);
    const t = text.trim();
    let role: SentenceRole = "body";

    if (isStepLine(text)) role = "step";
    else if (/^为什么[？?]?$|^具体怎么做[？?]?$|^怎么变[？?]?$|^这时候会发生什么[？?]?$/.test(t)) {
      role = "question";
    } else if (isSectionLine(text)) role = "section";
    else if (/什么叫|什么是|那什么叫/.test(text)) role = "question";
    else if (/更关键的是|就两点|关键就|获客的关键/.test(text)) role = "summary";
    else if (/^不是靠|^别指望/.test(t)) role = "fork_label";
    else if (/^不要/.test(t) || /不要说/.test(text)) role = "contrast_wrong";
    else if (/^你就|改成/.test(t)) role = "contrast_right";
    else if (i < 3 && isRhetoricalHook(text)) role = "question";
    else if (i >= sentences.length - 2 && /本质|你会发现|真正动起来/.test(text)) role = "summary";

    s.role = role;
  }
}

export function extractKeywordRange(sentence: LogicSentence, normalized: string): { start: number; end: number } {
  const text = sentenceText(normalized, sentence);
  const quote = text.match(/[「『""]([^」』""]{1,12})[」』""]/);
  if (quote && quote.index !== undefined) {
    const innerStart = text.indexOf(quote[1], quote.index);
    const offset = sentence.start + (normalized.slice(sentence.start, sentence.end).indexOf(text));
    return { start: offset + innerStart, end: offset + innerStart + quote[1].length };
  }

  const colon = text.search(/[：:]/);
  if (colon >= 0 && colon < text.length - 1) {
    const after = text.slice(colon + 1).trim();
    const kw = after.slice(0, Math.min(8, after.length));
    if (kw.length > 0) {
      const offset = sentence.start + (normalized.slice(sentence.start, sentence.end).indexOf(text));
      const idx = text.indexOf(kw, colon + 1);
      return { start: offset + idx, end: offset + idx + kw.length };
    }
  }

  const trimmed = text.trim();
  if (trimmed.length <= 12) {
    const offset = sentence.start + normalized.slice(sentence.start, sentence.end).indexOf(trimmed);
    return { start: offset, end: offset + trimmed.length };
  }

  const kwLen = Math.min(6, trimmed.length);
  const offset = sentence.start + normalized.slice(sentence.start, sentence.end).indexOf(text);
  const idx = text.indexOf(trimmed.slice(0, kwLen));
  return { start: offset + idx, end: offset + idx + kwLen };
}

export function recognizeEdges(sentences: LogicSentence[], normalized: string): LogicEdge[] {
  const edges: LogicEdge[] = [];
  const stepBlockMembers = new Set<string>();

  for (const chain of buildStepBlocks(sentences, normalized)) {
    for (const id of chain.sentenceIds) stepBlockMembers.add(id);
  }

  for (let i = 0; i < sentences.length - 1; i += 1) {
    const from = sentences[i];
    const to = sentences[i + 1];
    const fromText = sentenceText(normalized, from);
    const toText = sentenceText(normalized, to);

    if (stepBlockMembers.has(from.id) && stepBlockMembers.has(to.id)) {
      const sameBlock = buildStepBlocks(sentences, normalized).find(
        (b) => b.sentenceIds.includes(from.id) && b.sentenceIds.includes(to.id),
      );
      if (sameBlock && from.id !== sameBlock.sentenceIds[0]) continue;
    }

    if (isStepLine(fromText) && isStepLine(toText)) continue;
    if (isContrastPair(fromText, toText)) continue;
    if (from.role === "contrast_wrong" && to.role === "contrast_right") continue;

    if (/举个例子|譬如|比如说/.test(fromText)) {
      edges.push({ from: from.id, to: to.id, relation: "example_follow", arrowKind: "down" });
      continue;
    }

    if (from.role === "question" && to.role === "question") continue;
    if (from.role === "question" && to.role === "body" && /第一反应|报补习|奇怪的现象/.test(fromText + toText)) {
      continue;
    }

    if (/那怎么破局|怎么破局/.test(fromText) && isStepLine(toText)) {
      edges.push({ from: from.id, to: to.id, relation: "fork", arrowKind: "down" });
      continue;
    }

    if (/我们来拆解|简单来说|更关键的是/.test(fromText)) {
      edges.push({ from: from.id, to: to.id, relation: "transition", arrowKind: "down" });
      continue;
    }

    if (/^(所以|因此|你会发现|因为分数)/.test(toText.trim())) {
      edges.push({ from: from.id, to: to.id, relation: "conclude_from", arrowKind: "down" });
      continue;
    }

    if (/因为/.test(fromText) && /所以/.test(toText)) {
      edges.push({ from: from.id, to: to.id, relation: "cause", arrowKind: "down" });
      continue;
    }

    if (
      /^(然后|接着|于是|下一步|最后|再|但|这时候|更要命)/.test(toText.trim()) ||
      /会发生什么/.test(fromText)
    ) {
      edges.push({ from: from.id, to: to.id, relation: "sequential", arrowKind: "down" });
      continue;
    }

    if (/具体怎么做[？?]?$|怎么变[？?]?$|^为什么[？?]?$/.test(fromText.trim())) {
      edges.push({ from: from.id, to: to.id, relation: "sequential", arrowKind: "down" });
      continue;
    }

    if (from.role === "question" && !/^[？?]$/.test(toText.trim())) {
      edges.push({ from: from.id, to: to.id, relation: "sequential", arrowKind: "down" });
      continue;
    }

    if (/→|->|＝|=/.test(fromText) && toText.trim().length <= 20) {
      edges.push({ from: from.id, to: to.id, relation: "chain", arrowKind: "straight" });
    }
  }

  return edges;
}

const STEP_BLOCK_END = /^试试这样做|^道德经说|^你会发现，|^因为分数的本质/;

export function buildHookBlock(sentences: LogicSentence[], normalized: string): LogicChain | null {
  const ids: string[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i];
    if (s.role === "title" || s.role === "subtitle") continue;
    const text = sentenceText(normalized, s);
    if (isSectionLine(text) || isStepLine(text)) break;
    if (s.paragraphStart && ids.length > 0) break;
    ids.push(s.id);
    const next = sentences[i + 1];
    if (next) {
      const nextText = sentenceText(normalized, next);
      if (next.role === "section" || isSectionLine(nextText) || next.paragraphStart) break;
    }
  }
  if (ids.length < 2) return null;
  const firstBody = sentences.find((s) => s.role !== "title" && s.role !== "subtitle");
  if (!firstBody || ids[0] !== firstBody.id) return null;
  return { id: "chain_hook", kind: "hook_block", sentenceIds: ids, edges: [] };
}

export function parseEnumeratedItem(text: string): { ordinal: string; content: string } | null {
  const m = text.trim().match(/^(第[一二三四五六七八九十\d]+)[，,：:\s]*([\s\S]+?)[；;]?$/);
  if (!m) return null;
  return { ordinal: m[1], content: m[2].replace(/[；;]$/, "").trim() };
}

export function parseEnumeratedIntro(text: string): { intro: string; firstItem: { ordinal: string; content: string } } | null {
  const m = text.match(/^([\s\S]*?[：:])\s*(第[一二三四五六七八九十\d]+[，,]\s*[\s\S]+)$/);
  if (!m) return null;
  const firstItem = parseEnumeratedItem(m[2]);
  if (!firstItem) return null;
  return { intro: m[1], firstItem };
}

export function buildEnumeratedBlocks(sentences: LogicSentence[], normalized: string): LogicChain[] {
  const blocks: LogicChain[] = [];
  let i = 0;
  while (i < sentences.length) {
    const text = sentenceText(normalized, sentences[i]);
    const intro = parseEnumeratedIntro(text);
    if (intro) {
      const ids = [sentences[i].id];
      let j = i + 1;
      while (j < sentences.length) {
        const nextText = sentenceText(normalized, sentences[j]);
        if (!parseEnumeratedItem(nextText)) break;
        ids.push(sentences[j].id);
        j += 1;
      }
      if (ids.length >= 2) {
        blocks.push({
          id: `chain_enum_${blocks.length}`,
          kind: "enumerated_list",
          sentenceIds: ids,
          edges: [],
        });
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return blocks;
}

export function buildStepBlocks(sentences: LogicSentence[], normalized: string): LogicChain[] {
  const blocks: LogicChain[] = [];
  let i = 0;
  while (i < sentences.length) {
    const text = sentenceText(normalized, sentences[i]);
    if (!isStepLine(text)) {
      i += 1;
      continue;
    }
    const ids = [sentences[i].id];
    i += 1;
    while (i < sentences.length) {
      const nextText = sentenceText(normalized, sentences[i]);
      if (isStepLine(nextText)) break;
      if (STEP_BLOCK_END.test(nextText)) break;
      ids.push(sentences[i].id);
      i += 1;
    }
    blocks.push({
      id: `chain_stepblock_${blocks.length}`,
      kind: "step_block",
      sentenceIds: ids,
      edges: [],
    });
  }
  return blocks;
}

export function buildChains(sentences: LogicSentence[], edges: LogicEdge[], normalized: string): LogicChain[] {
  const chains: LogicChain[] = [];
  const hook = buildHookBlock(sentences, normalized);
  if (hook) chains.push(hook);
  chains.push(...buildEnumeratedBlocks(sentences, normalized));
  chains.push(...buildStepBlocks(sentences, normalized));
  const edgeBetween = new Map<string, LogicEdge>();
  for (const e of edges) {
    edgeBetween.set(`${e.from}->${e.to}`, e);
  }

  let stepRun: string[] = [];
  for (const s of sentences) {
    const text = sentenceText(normalized, s);
    if (/^Step\s*\d/i.test(text.trim()) || /^[①②③④⑤⑥⑦⑧⑨]/.test(text.trim())) {
      stepRun.push(s.id);
    } else if (stepRun.length > 0) {
      chains.push({
        id: `chain_step_${chains.length}`,
        kind: "step_list",
        sentenceIds: [...stepRun],
        edges: [],
      });
      stepRun = [];
    }
  }
  if (stepRun.length > 0) {
    chains.push({
      id: `chain_step_${chains.length}`,
      kind: "step_list",
      sentenceIds: stepRun,
      edges: [],
    });
  }

  const chainable = new Set<EdgeRelation>(["chain", "sequential", "cause", "equiv"]);
  let run: string[] = [];
  let runEdges: LogicEdge[] = [];

  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i];
    const next = sentences[i + 1];
    const edge = next ? edgeBetween.get(`${s.id}->${next.id}`) : undefined;

    if (edge && chainable.has(edge.relation) && edge.arrowKind === "straight") {
      if (run.length === 0) run.push(s.id);
      run.push(next.id);
      runEdges.push(edge);
    } else {
      if (run.length >= 2) {
        chains.push({
          id: `chain_mm_${chains.length}`,
          kind: "mindmap_chain",
          sentenceIds: [...run],
          edges: [...runEdges],
        });
      }
      run = [];
      runEdges = [];
    }
  }
  if (run.length >= 2) {
    chains.push({
      id: `chain_mm_${chains.length}`,
      kind: "mindmap_chain",
      sentenceIds: run,
      edges: runEdges,
    });
  }

  return chains;
}

export function detectTitle(
  sentences: LogicSentence[],
  normalized: string,
): { title?: { start: number; end: number; sentenceId: string }; subtitle?: { start: number; end: number; sentenceId: string } } {
  if (sentences.length === 0) return {};

  const first = sentences[0];
  const firstText = sentenceText(normalized, first);
  const looksTitle =
    !isRhetoricalHook(firstText) &&
    firstText.length <= 48 &&
    (/^如何|^怎么做一个|^叙事转换|^获客型/.test(firstText.trim()) || /一共分.*步/.test(firstText));

  if (!looksTitle) return {};

  first.role = "title";
  const title = { start: first.start, end: first.end, sentenceId: first.id };

  const second = sentences[1];
  if (second && sentenceText(normalized, second).length <= 60 && !second.paragraphStart) {
    second.role = "subtitle";
    return {
      title,
      subtitle: { start: second.start, end: second.end, sentenceId: second.id },
    };
  }

  return { title };
}

export function detectEmphasis(sentences: LogicSentence[], normalized: string): LogicEmphasis[] {
  const out: LogicEmphasis[] = [];
  const keyTerms = ["认知负荷", "反者道之动", "要我学", "我要学", "少则得，多则惑", "有效连接", "安全时间"];

  for (const s of sentences) {
    const raw = normalized.slice(s.start, s.end);
    const text = sentenceText(normalized, s);

    if (s.role === "title" || s.role === "summary") {
      out.push({ start: s.start, end: s.end, kind: "size_up", sentenceId: s.id });
    }
    if (s.role === "section") {
      out.push({ start: s.start, end: s.end, kind: "underline", sentenceId: s.id });
    }
    if (s.role === "fork_label" || s.role === "define") {
      out.push({ start: s.start, end: s.end, kind: "frame", sentenceId: s.id });
    }
    if (s.role === "contrast_wrong") {
      out.push({ start: s.start, end: s.end, kind: "mark_x", sentenceId: s.id });
    }
    if (s.role === "contrast_right") {
      out.push({ start: s.start, end: s.end, kind: "mark_check", sentenceId: s.id });
    }

    for (const term of keyTerms) {
      const idx = text.indexOf(term);
      if (idx >= 0) {
        const offset = s.start + raw.indexOf(text) + idx;
        out.push({ start: offset, end: offset + term.length, kind: "red_text", sentenceId: s.id });
      }
    }

    const quoteRe = /[「『""]([^」』""]{1,24})[」』""]/g;
    let m: RegExpExecArray | null;
    while ((m = quoteRe.exec(text)) !== null) {
      const inner = m[1];
      const innerStart = text.indexOf(inner, m.index);
      const offset = s.start + raw.indexOf(text);
      out.push({
        start: offset + innerStart,
        end: offset + innerStart + inner.length,
        kind: "underline",
        sentenceId: s.id,
      });
    }
  }

  return out;
}

export function parseStepLabel(text: string): { label: string; rest: string } {
  const m = text.trim().match(/^(第[一二三四五六七八九十\d]+步)[，,：:\s]*([\s\S]*)$/);
  if (!m) return { label: text.slice(0, 8), rest: text };
  return { label: m[1], rest: m[2].trim() };
}

export function parseContrastParts(text: string): { wrong?: string; right?: string; note?: string } | null {
  const m = text.match(/不要[说]?[「""]([^」""]+)[」""][，,]\s*改成[「""]([^」""]+)[」""]/);
  if (m) {
    const noteM = text.match(/(前者[^，,。]+[，,]\s*后者[^。]+)/);
    return { wrong: m[1].trim(), right: m[2].trim(), note: noteM?.[1] };
  }
  const wrongM = text.match(/不要[「""]?([^」""，,？?]+)[」""]?/);
  const rightM = text.match(/改成[「""]?([^」""，,？?]+)[」""]?/);
  if (wrongM && rightM) {
    const noteM = text.match(/(前者[^，,。]+[，,]\s*后者[^。]+)/);
    return { wrong: wrongM[1].trim(), right: rightM[1].trim(), note: noteM?.[1] };
  }
  return null;
}

export function parseFormulaChain(text: string): string[] | null {
  if (!/→/.test(text)) return null;
  const parts = text
    .split(/→/)
    .map((p) => p.replace(/^[因为：:\s]+/, "").replace(/[。！？；;].*$/, "").trim())
    .filter((p) => p.length > 0 && p.length <= 12);
  return parts.length >= 2 ? parts : null;
}
