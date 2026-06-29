import type { LogicChain, LogicManuscriptIR } from "./types";
import type { PatternCaseBox, PosterDocumentV2, PosterSection, SectionPattern } from "../types";
import { sentenceText } from "./splitSentences";
import {
  buildHookBlock,
  parseContrastParts,
  parseEnumeratedIntro,
  parseEnumeratedItem,
  parseFormulaChain,
  parseStepLabel,
} from "./recognize";

type Phase = {
  label?: string;
  sentenceIds: string[];
};

function textOf(ir: LogicManuscriptIR, id: string): string {
  const s = ir.sentences.find((x) => x.id === id);
  return s ? sentenceText(ir.normalized, s) : "";
}

function sourceOf(ir: LogicManuscriptIR, ids: string[]): string {
  return ids.map((id) => textOf(ir, id)).join("");
}

function chainAt(ir: LogicManuscriptIR, sid: string, kind: LogicChain["kind"]): LogicChain | undefined {
  return ir.chains.find((c) => c.kind === kind && c.sentenceIds[0] === sid);
}

function isChainStart(ir: LogicManuscriptIR, sid: string): boolean {
  return ir.chains.some((c) => c.sentenceIds[0] === sid && c.sentenceIds.length > 1);
}

// 长句当 section 标题会换行成「另一段正文」，破坏视觉层级；
// 这里给过长的 section 句生成 4-8 字短标签，原文仍作为正文保留。
function shortSectionLabel(text: string): string {
  const clean = text.replace(/[。！？；;]+$/, "").trim();
  if (clean.length <= 16) return clean;
  if (/^你会发现|^当我们不再|^当你不再/.test(clean)) return "结语";
  if (/^因为分数|^因为真正|^本质/.test(clean)) return "本质回归";
  if (/^试试这样做|^这样做|^实操/.test(clean)) return "落地做法";
  if (/^道德经说|^道德经里|^老子说/.test(clean)) return "经典映照";
  return clean.slice(0, 8);
}

const CONCLUSION_RE = /^你会发现|^因为分数的本质|^当我们不再|^当你不再|^因为真正的学习/;

function splitPhases(ir: LogicManuscriptIR): Phase[] {
  const phases: Phase[] = [];
  const hook = buildHookBlock(ir.sentences, ir.normalized);
  const hookIds = new Set(hook?.sentenceIds ?? []);
  const skip = new Set<string>();
  if (ir.title?.sentenceId) skip.add(ir.title.sentenceId);
  if (ir.subtitle?.sentenceId) skip.add(ir.subtitle.sentenceId);

  if (hook && hook.sentenceIds.length >= 2) {
    phases.push({ label: "引子", sentenceIds: [...hook.sentenceIds] });
  }

  const majorSection =
    /^我们来拆解|^那怎么破局|^试试这样做|^你会发现|^因为分数的本质|^如何|^怎么做一个/;

  let current: Phase | null = null;
  for (const s of ir.sentences) {
    if (skip.has(s.id) || hookIds.has(s.id)) continue;

    if (s.role === "section") {
      const text = textOf(ir, s.id);
      if (majorSection.test(text)) {
        const clean = text.replace(/[。！？；;]+$/, "").trim();
        const isConclusion = CONCLUSION_RE.test(text);
        const label = isConclusion ? "结语" : shortSectionLabel(text);
        // 连续结语句合并到同一个「结语」段，不再每句开一个 section
        if (isConclusion && current && current.label === "结语") {
          current.sentenceIds.push(s.id);
          continue;
        }
        if (current && current.sentenceIds.length > 0) phases.push(current);
        // 标签被缩短时，原句必须进正文，否则丢字（保真）
        const shortened = label !== clean;
        current = {
          label,
          sentenceIds: shortened ? [s.id] : [],
        };
      } else if (current) {
        current.sentenceIds.push(s.id);
      } else {
        current = { label: shortSectionLabel(text), sentenceIds: [] };
      }
      continue;
    }

    if (!current) current = { sentenceIds: [] };
    current.sentenceIds.push(s.id);
  }
  if (current && current.sentenceIds.length > 0) phases.push(current);
  return phases;
}

function enumeratedToTripletList(chain: LogicChain, ir: LogicManuscriptIR): SectionPattern {
  const firstText = textOf(ir, chain.sentenceIds[0]);
  const intro = parseEnumeratedIntro(firstText);
  const items: string[] = [];
  if (intro) {
    items.push(`${intro.firstItem.ordinal}，${intro.firstItem.content}`);
    for (const sid of chain.sentenceIds.slice(1)) {
      const item = parseEnumeratedItem(textOf(ir, sid));
      if (item) items.push(`${item.ordinal}，${item.content}`);
    }
    return {
      pattern: "triplet_list",
      title: intro.intro.replace(/[：:]$/, ""),
      items,
    };
  }
  return { pattern: "free_paragraph", text: sourceOf(ir, chain.sentenceIds) };
}

function stepBlockToCaseBox(chain: LogicChain, ir: LogicManuscriptIR): PatternCaseBox {
  const firstText = textOf(ir, chain.sentenceIds[0]);
  const { label, rest } = parseStepLabel(firstText);
  const bodyParts: string[] = [];
  if (rest) bodyParts.push(rest);

  let wrong: string | undefined;
  let right: string | undefined;

  for (const sid of chain.sentenceIds.slice(1)) {
    const t = textOf(ir, sid);
    const contrast = parseContrastParts(t);
    if (contrast?.wrong && contrast?.right) {
      wrong = contrast.wrong;
      right = contrast.right;
      if (contrast.note) bodyParts.push(contrast.note);
      continue;
    }
    bodyParts.push(t);
  }

  return {
    pattern: "case_box",
    label,
    punch: rest || undefined,
    wrong,
    right,
    body: bodyParts.join(""),
  };
}

function hookToPattern(ids: string[], ir: LogicManuscriptIR): SectionPattern {
  if (ids.length >= 3) {
    return {
      pattern: "scene_with_quotes",
      scene: textOf(ir, ids[0]) + textOf(ir, ids[1]),
      quotes: [textOf(ir, ids[2])],
    };
  }
  return { pattern: "free_paragraph", text: sourceOf(ir, ids), emphasis: "red" };
}

function buildPatternsForPhase(phase: Phase, ir: LogicManuscriptIR): SectionPattern[] {
  const patterns: SectionPattern[] = [];
  const handled = new Set<string>();
  const ids = phase.sentenceIds;

  if (phase.label === "引子") {
    patterns.push(hookToPattern(ids, ir));
    return patterns;
  }

  let i = 0;
  while (i < ids.length) {
    const sid = ids[i];
    if (handled.has(sid)) {
      i += 1;
      continue;
    }

    const enumChain = chainAt(ir, sid, "enumerated_list");
    if (enumChain) {
      patterns.push(enumeratedToTripletList(enumChain, ir));
      for (const id of enumChain.sentenceIds) handled.add(id);
      i += enumChain.sentenceIds.length;
      continue;
    }

    const stepChain = chainAt(ir, sid, "step_block");
    if (stepChain) {
      patterns.push(stepBlockToCaseBox(stepChain, ir));
      for (const id of stepChain.sentenceIds) handled.add(id);
      i += stepChain.sentenceIds.length;
      continue;
    }

    const s = ir.sentences.find((x) => x.id === sid)!;
    const text = textOf(ir, sid);

    const contrast = parseContrastParts(text);
    if (contrast?.wrong && contrast?.right) {
      patterns.push({
        pattern: "contrast_card",
        wrong: contrast.wrong,
        right: contrast.right,
      });
      if (contrast.note) {
        patterns.push({ pattern: "free_paragraph", text: contrast.note, emphasis: "red" });
      }
      handled.add(sid);
      i += 1;
      continue;
    }

    const formula = parseFormulaChain(text);
    if (formula && formula.length >= 3) {
      patterns.push({ pattern: "formula_chain", items: formula });
      handled.add(sid);
      i += 1;
      continue;
    }

    if (s.role === "summary") {
      patterns.push({ pattern: "summary", text });
      handled.add(sid);
      i += 1;
      continue;
    }

    // section 句单独成块：短句当 highlight 强调，长句（>40）单独成带强调的正文段，
    // 不能被吞进下面的 free_paragraph run（否则「道德经说…」「你会发现…」会埋进大段文字）。
    if (s.role === "section") {
      const stripped = text.replace(/[。]+$/, "");
      if (stripped.length <= 40) {
        patterns.push({ pattern: "highlight", text: stripped });
      } else {
        const emphasis = /越.*越|反而|不是.*而是|本质/.test(text) ? "red" : "normal";
        patterns.push({ pattern: "free_paragraph", text: stripped, emphasis });
      }
      handled.add(sid);
      i += 1;
      continue;
    }

    if (/^[^。]{2,28}[""][^""]{2,12}[""][。]?$/.test(text)) {
      patterns.push({ pattern: "highlight", text: text.replace(/[。]+$/, "") });
      handled.add(sid);
      i += 1;
      continue;
    }

    const run: string[] = [];
    let j = i;
    while (j < ids.length) {
      const runId = ids[j];
      if (handled.has(runId) || isChainStart(ir, runId)) break;
      const runS = ir.sentences.find((x) => x.id === runId)!;
      const runText = textOf(ir, runId);
      if (runS.role === "summary") break;
      // section 句（如「道德经说…」）要单独成 highlight，不能被吞进正文 run
      if (runS.role === "section") break;
      if (parseContrastParts(runText)?.wrong) break;
      if (parseFormulaChain(runText)?.length) break;
      run.push(runText);
      handled.add(runId);
      j += 1;
      if (runS.role === "question") break;
    }
    if (run.length > 0) {
      const joined = run.join("");
      const emphasis = /越.*越|反而|不是.*而是/.test(joined) ? "red" : "normal";
      patterns.push({ pattern: "free_paragraph", text: joined, emphasis });
    }
    i = Math.max(i + 1, j);
  }

  return patterns;
}

function deriveTitle(ir: LogicManuscriptIR): string {
  if (ir.title?.sentenceId) return textOf(ir, ir.title.sentenceId);
  const hook = buildHookBlock(ir.sentences, ir.normalized);
  if (hook?.sentenceIds[0]) {
    const t = textOf(ir, hook.sentenceIds[0]);
    if (t.length <= 48) return t.replace(/[？?]+$/, "");
  }
  const first = ir.sentences.find((s) => s.role !== "title" && s.role !== "subtitle");
  return first ? textOf(ir, first.id).slice(0, 36) : "讲义长图";
}

// 从 step 的 rest 里抽 4 字关键词：
// 优先取「变成/转为/→」之后的结果，否则去掉前导「把/将/让/使」再取首 4 字。
// 修复「把"要我学"变成"我要学"」被切成「把要我学」这种半截词的问题。
function stepKeyword(rest: string): string {
  let r = rest.replace(/[""]/g, "").trim();
  const after = r.split(/变成|转为|转化为|变为|→/).pop()?.trim();
  if (after && after.length >= 2) r = after;
  r = r.replace(/^[把将让使给]+/, "").trim();
  r = r.replace(/[，,。：:].*$/, "").trim();
  return r.slice(0, 4) || "步骤";
}

function deriveOverview(ir: LogicManuscriptIR): string[] | undefined {
  const steps = ir.chains.filter((c) => c.kind === "step_block");
  if (steps.length >= 3) {
    return steps.slice(0, 3).map((c) => {
      const { rest } = parseStepLabel(textOf(ir, c.sentenceIds[0]));
      return stepKeyword(rest);
    });
  }
  const keywords = ["认知负荷", "破局", "内驱力"].filter((kw) => ir.normalized.includes(kw));
  if (keywords.length >= 2) return keywords.slice(0, 3).map((k) => k.slice(0, 4));
  return undefined;
}

export function irToPosterV2(ir: LogicManuscriptIR): PosterDocumentV2 {
  const phases = splitPhases(ir);
  let sectionNo = 0;
  const sections: PosterSection[] = [];

  for (const phase of phases) {
    const body = buildPatternsForPhase(phase, ir);
    if (body.length === 0) continue;

    const isHook = phase.label === "引子";
    if (!isHook) sectionNo += 1;

    sections.push({
      no: isHook ? undefined : sectionNo,
      label: isHook ? undefined : phase.label,
      body,
      source: sourceOf(ir, phase.sentenceIds),
    });
  }

  return {
    title: deriveTitle(ir),
    overview: deriveOverview(ir),
    sections,
  };
}
