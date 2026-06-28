import type { LogicChain, LogicEdge, LogicEmphasis, LogicSentence, SentenceRole, EdgeRelation } from "./types";
import { sentenceText } from "./splitSentences";

function isStepLine(text: string): boolean {
  const t = text.trim();
  return /^Step\s*\d/i.test(t) || /^第[一二三四五\d]+步/.test(t) || /^[①②③④⑤⑥⑦⑧⑨]/.test(t);
}

function isContrastPair(fromText: string, toText: string): boolean {
  if (/不要|不是|别指望|不是靠|别讲|不要去/.test(fromText) && /你就|而是|应该|要/.test(toText)) {
    return true;
  }
  if (fromText.includes("❌") || fromText.includes("✘")) return true;
  return false;
}

export function assignSentenceRoles(sentences: LogicSentence[], normalized: string): void {
  for (const s of sentences) {
    const text = sentenceText(normalized, s);
    const t = text.trim();
    let role: SentenceRole = "body";

    if (isStepLine(text)) role = "step";
    else if (/什么叫|什么是|那什么叫/.test(text)) role = "question";
    else if (/更关键的是|就两点|关键就|获客的关键/.test(text)) role = "summary";
    else if (/不是靠|不是靠|别指望/.test(text)) role = "fork_label";
    else if (/^(不要|别)/.test(t) || /不要去讲|不要讲/.test(text)) role = "contrast_wrong";
    else if (/^你就|你就给他|你就给/.test(t)) role = "contrast_right";
    else if (/简单来说|举个例子|譬如|比如说/.test(text)) role = "body";

    s.role = role;
  }
}

export function extractKeywordRange(sentence: LogicSentence, normalized: string): { start: number; end: number } {
  const text = sentenceText(normalized, sentence);
  const quote = text.match(/[「『]([^」』]{1,12})[」』]/);
  if (quote && quote.index !== undefined) {
    const innerStart = text.indexOf(quote[1], quote.index);
    return { start: sentence.start + innerStart, end: sentence.start + innerStart + quote[1].length };
  }

  const colon = text.search(/[：:]/);
  if (colon >= 0 && colon < text.length - 1) {
    const after = text.slice(colon + 1).trim();
    const kw = after.slice(0, Math.min(8, after.length));
    if (kw.length > 0) {
      const idx = text.indexOf(kw, colon + 1);
      return { start: sentence.start + idx, end: sentence.start + idx + kw.length };
    }
  }

  const trimmed = text.trim();
  if (trimmed.length <= 12) {
    return { start: sentence.start, end: sentence.end };
  }

  const kwLen = Math.min(6, trimmed.length);
  const idx = text.indexOf(trimmed.slice(0, kwLen));
  return { start: sentence.start + idx, end: sentence.start + idx + kwLen };
}

export function recognizeEdges(sentences: LogicSentence[], normalized: string): LogicEdge[] {
  const edges: LogicEdge[] = [];
  const byId = new Map(sentences.map((s) => [s.id, s]));

  for (let i = 0; i < sentences.length - 1; i += 1) {
    const from = sentences[i];
    const to = sentences[i + 1];
    const fromText = sentenceText(normalized, from);
    const toText = sentenceText(normalized, to);

    if (isStepLine(fromText) && isStepLine(toText)) continue;
    if (/^[①②③④⑤⑥⑦⑧⑨]/.test(fromText.trim()) && /^[①②③④⑤⑥⑦⑧⑨]/.test(toText.trim())) {
      continue;
    }
    if (isContrastPair(fromText, toText)) continue;
    if (from.role === "contrast_wrong" && to.role === "contrast_right") continue;

    if (/举个例子|譬如|比如说/.test(fromText)) {
      edges.push({ from: from.id, to: to.id, relation: "example_follow", arrowKind: "down" });
      continue;
    }

    if (/更关键的是|重要的是这两个|就两个|两点|分五步|一共分/.test(fromText)) {
      edges.push({ from: from.id, to: to.id, relation: "fork", arrowKind: "fork" });
      continue;
    }

    if (/^(所以|因此|这就说明|于是|核心问题)/.test(toText.trim())) {
      edges.push({ from: from.id, to: to.id, relation: "conclude_from", arrowKind: "down" });
      continue;
    }

    if (/因为/.test(fromText) && /所以/.test(toText)) {
      edges.push({ from: from.id, to: to.id, relation: "cause", arrowKind: "down" });
      continue;
    }

    if (/^(然后|接着|于是|下一步|最后|再|但)/.test(toText.trim())) {
      edges.push({ from: from.id, to: to.id, relation: "sequential", arrowKind: "down" });
      continue;
    }

    if (/简单来说|更关键的是|如何做一个|如何做/.test(fromText)) {
      edges.push({ from: from.id, to: to.id, relation: "transition", arrowKind: "down" });
      continue;
    }

    if (/什么叫|什么是/.test(fromText) && !/什么叫|什么是/.test(toText)) {
      edges.push({ from: from.id, to: to.id, relation: "sequential", arrowKind: "down" });
      continue;
    }

    if (/缺少了这个/.test(toText)) {
      edges.push({ from: from.id, to: to.id, relation: "sequential", arrowKind: "down" });
      continue;
    }

    if (/→|->|＝|=/.test(fromText) && toText.trim().length <= 16) {
      edges.push({ from: from.id, to: to.id, relation: "chain", arrowKind: "straight" });
    }
  }

  void byId;
  return edges;
}

export function buildChains(sentences: LogicSentence[], edges: LogicEdge[], normalized: string): LogicChain[] {
  const chains: LogicChain[] = [];
  const edgeBetween = new Map<string, LogicEdge>();
  for (const e of edges) {
    edgeBetween.set(`${e.from}->${e.to}`, e);
  }

  let stepRun: string[] = [];
  for (const s of sentences) {
    const text = sentenceText(normalized, s);
    if (isStepLine(text)) {
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

  const forkLabels = sentences.filter((s) => s.role === "fork_label");
  for (const fl of forkLabels) {
    const idx = sentences.findIndex((s) => s.id === fl.id);
    const children = sentences.slice(idx + 1, idx + 7).filter((s) => s.role !== "fork_label");
    if (children.length >= 2) {
      chains.push({
        id: `chain_fan_${chains.length}`,
        kind: "fan_neg",
        sentenceIds: [fl.id, ...children.map((c) => c.id)],
        edges: edges.filter((e) => e.from === fl.id),
        groupDeny: true,
      });
    }
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
    firstText.length <= 80 &&
    (/[？?]/.test(firstText) || /如何|怎么|为什么|什么是/.test(firstText) || /一共分.*步/.test(firstText));

  if (!looksTitle) return {};

  first.role = "title";
  const title = { start: first.start, end: first.end, sentenceId: first.id };

  const second = sentences[1];
  if (second && sentenceText(normalized, second).length <= 60) {
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

  for (const s of sentences) {
    const text = sentenceText(normalized, s);
    if (s.role === "title" || s.role === "summary") {
      out.push({ start: s.start, end: s.end, kind: "size_up", sentenceId: s.id });
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

    const quoteRe = /[「『]([^」』]{1,20})[」』]/g;
    let m: RegExpExecArray | null;
    while ((m = quoteRe.exec(text)) !== null) {
      const inner = m[1];
      const innerStart = text.indexOf(inner, m.index);
      out.push({
        start: s.start + innerStart,
        end: s.start + innerStart + inner.length,
        kind: "underline",
        sentenceId: s.id,
      });
    }
  }

  return out;
}
