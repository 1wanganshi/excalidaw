import type { PosterDocumentV2, PosterSection, SectionPattern } from "../types";
import type { AiLogicLayoutPlan, AiPatternPlan } from "./aiLayoutTypes";
import type { LogicManuscriptIR } from "./types";
import { sentenceText } from "./splitSentences";
import {
  parseContrastParts,
  parseEnumeratedIntro,
  parseEnumeratedItem,
  parseFormulaChain,
  parseStepLabel,
} from "./recognize";
import { irToPosterV2 } from "./irToPosterV2";

function textOf(ir: LogicManuscriptIR, ref: string): string {
  const s = ir.sentences.find((x) => x.id === ref);
  if (!s) throw new Error(`未知句子 ID：${ref}`);
  return sentenceText(ir.normalized, s);
}

function joinRefs(ir: LogicManuscriptIR, refs: string[]): string {
  return refs.map((r) => textOf(ir, r)).join("");
}

function collectRefs(plan: AiLogicLayoutPlan): string[] {
  const out: string[] = [];
  const add = (r?: string) => {
    if (r) out.push(r);
  };
  const addMany = (rs?: string[]) => {
    if (rs) out.push(...rs);
  };

  add(plan.titleRef);
  for (const sec of plan.sections) {
    for (const p of sec.patterns) {
      switch (p.pattern) {
        case "free_paragraph":
        case "case_box":
          addMany(p.refs);
          break;
        case "highlight":
        case "summary":
        case "contrast_card":
        case "formula_chain":
          add(p.ref);
          break;
        case "triplet_list":
          add(p.titleRef);
          addMany(p.refs);
          break;
        case "scene_with_quotes":
          addMany(p.sceneRefs);
          addMany(p.quoteRefs);
          break;
        case "central_negation":
          addMany(p.refs);
          break;
        case "triplet_circles":
          break;
      }
    }
  }
  return out;
}

function resolvePattern(ir: LogicManuscriptIR, p: AiPatternPlan): SectionPattern | null {
  switch (p.pattern) {
    case "free_paragraph":
      return {
        pattern: "free_paragraph",
        text: joinRefs(ir, p.refs),
        emphasis: p.emphasis ?? "normal",
      };
    case "highlight":
      return { pattern: "highlight", text: textOf(ir, p.ref).replace(/[。]+$/, "") };
    case "summary":
      return { pattern: "summary", text: textOf(ir, p.ref) };
    case "contrast_card": {
      const t = textOf(ir, p.ref);
      const c = parseContrastParts(t);
      if (c?.wrong && c?.right) {
        return { pattern: "contrast_card", wrong: c.wrong, right: c.right };
      }
      return { pattern: "free_paragraph", text: t };
    }
    case "formula_chain": {
      const items = parseFormulaChain(textOf(ir, p.ref));
      if (items && items.length >= 2) return { pattern: "formula_chain", items };
      return { pattern: "free_paragraph", text: textOf(ir, p.ref) };
    }
    case "triplet_list": {
      const items: string[] = [];
      let title = p.titleRef ? textOf(ir, p.titleRef).replace(/[：:].*$/, "").replace(/[。]+$/, "") : "";
      for (const ref of p.refs) {
        const t = textOf(ir, ref);
        const intro = parseEnumeratedIntro(t);
        if (intro) {
          if (!title) title = intro.intro.replace(/[：:]$/, "");
          items.push(`${intro.firstItem.ordinal}，${intro.firstItem.content}`);
          continue;
        }
        const item = parseEnumeratedItem(t);
        if (item) items.push(`${item.ordinal}，${item.content}`);
        else items.push(t);
      }
      return { pattern: "triplet_list", title, items };
    }
    case "scene_with_quotes":
      return {
        pattern: "scene_with_quotes",
        scene: joinRefs(ir, p.sceneRefs),
        quotes: p.quoteRefs.map((r) => textOf(ir, r)),
      };
    case "case_box": {
      const refs = p.refs;
      if (refs.length === 0) return null;
      const firstText = textOf(ir, refs[0]);
      const { label, rest } = parseStepLabel(firstText);
      const bodyParts: string[] = [];
      if (rest) bodyParts.push(rest);
      let wrong: string | undefined;
      let right: string | undefined;
      for (const ref of refs.slice(1)) {
        const t = textOf(ir, ref);
        const c = parseContrastParts(t);
        if (c?.wrong && c?.right) {
          wrong = c.wrong;
          right = c.right;
          if (c.note) bodyParts.push(c.note);
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
    case "central_negation":
      return {
        pattern: "central_negation",
        center: p.center,
        options: p.refs.map((r) => textOf(ir, r).slice(0, 6)),
      };
    case "triplet_circles":
      return { pattern: "triplet_circles", items: p.items };
    default:
      return null;
  }
}

export type ResolveResult = {
  doc: PosterDocumentV2;
  ok: boolean;
  message: string;
  missing: string[];
  extra: string[];
};

export function resolveLayoutPlan(ir: LogicManuscriptIR, plan: AiLogicLayoutPlan): ResolveResult {
  const allIds = new Set(ir.sentences.map((s) => s.id));
  const used = collectRefs(plan);
  const usedSet = new Set(used);
  const missing = [...allIds].filter((id) => !usedSet.has(id));
  const extra = used.filter((id) => !allIds.has(id));
  const dup = used.filter((id, i) => used.indexOf(id) !== i);

  if (extra.length > 0 || dup.length > 0) {
    return {
      doc: irToPosterV2(ir),
      ok: false,
      message: `AI 布局无效（多余 ID: ${extra.join(",") || "无"}；重复: ${[...new Set(dup)].join(",") || "无"}），已回退本地布局。`,
      missing,
      extra,
    };
  }

  if (missing.length > 0) {
    return {
      doc: irToPosterV2(ir),
      ok: false,
      message: `AI 布局未覆盖 ${missing.length} 句（${missing.slice(0, 5).join(",")}…），已回退本地布局。`,
      missing,
      extra,
    };
  }

  const sections: PosterSection[] = [];
  for (const sec of plan.sections) {
    const body: SectionPattern[] = [];
    const sourceIds: string[] = [];
    for (const p of sec.patterns) {
      if (p.pattern === "contrast_card") {
        const t = textOf(ir, p.ref);
        const c = parseContrastParts(t);
        if (c?.wrong && c?.right) {
          body.push({ pattern: "contrast_card", wrong: c.wrong, right: c.right });
          if (c.note) body.push({ pattern: "free_paragraph", text: c.note, emphasis: "red" });
          sourceIds.push(p.ref);
          continue;
        }
      }
      const resolved = resolvePattern(ir, p);
      if (!resolved) continue;
      body.push(resolved);
      if (p.pattern === "triplet_circles") continue;
      if (p.pattern === "free_paragraph") sourceIds.push(...p.refs);
      else if (p.pattern === "case_box") sourceIds.push(...p.refs);
      else if (p.pattern === "triplet_list") {
        if (p.titleRef) sourceIds.push(p.titleRef);
        sourceIds.push(...p.refs);
      } else if (p.pattern === "scene_with_quotes") sourceIds.push(...p.sceneRefs, ...p.quoteRefs);
      else if (p.pattern === "central_negation") sourceIds.push(...p.refs);
      else if ("ref" in p && p.ref) sourceIds.push(p.ref);
    }
    if (body.length === 0) continue;
    sections.push({
      no: sec.no,
      label: sec.label,
      body,
      source: joinRefs(ir, [...new Set(sourceIds)]),
    });
  }

  const title = plan.titleRef
    ? textOf(ir, plan.titleRef).replace(/[？?]+$/, "").slice(0, 48)
    : irToPosterV2(ir).title;

  return {
    doc: {
      title,
      overview: plan.overview?.length ? plan.overview : undefined,
      sections,
    },
    ok: true,
    message: `AI 布局计划已解析：${sections.length} 个章节，${sections.reduce((n, s) => n + s.body.length, 0)} 个 pattern。`,
    missing: [],
    extra: [],
  };
}

export function parseAiLayoutPlan(raw: unknown): AiLogicLayoutPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.sections)) return null;
  return {
    titleRef: typeof o.titleRef === "string" ? o.titleRef : undefined,
    overview: Array.isArray(o.overview) ? o.overview.filter((x) => typeof x === "string") : undefined,
    sections: o.sections as AiLogicLayoutPlan["sections"],
  };
}
