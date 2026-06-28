import type { PosterTheme } from "../types";
import { CONTENT_WIDTH, POSTER_PADDING, POSTER_THEMES, POSTER_WIDTH, type ThemeSpec } from "../poster/themes";
import { sentenceText } from "./splitSentences";
import { pushArrow, pushCheck, pushCross, pushLine, pushRect, pushText, type Skel } from "./draw";
import { glyphH, lineH, measure, textWidth } from "./measure";
import type { LogicEdge, LogicManuscriptIR } from "./types";

const SENTENCE_GAP = 28;
const CHAIN_GAP = 72;
const ARROW_GAP = 16;

type Origin = { x: number; y: number };

function edgeBetween(ir: LogicManuscriptIR, fromId: string, toId: string): LogicEdge | undefined {
  return ir.edges.find((e) => e.from === fromId && e.to === toId);
}

function renderTitleBlock(
  out: Skel[],
  ir: LogicManuscriptIR,
  theme: ThemeSpec,
  left: number,
  y: number,
): number {
  if (!ir.title) return 0;
  const text = ir.normalized.slice(ir.title.start, ir.title.end);
  const fs = theme.fontTitle;
  const m = measure(text, fs, CONTENT_WIDTH);
  pushText(out, {
    x: left,
    y,
    w: CONTENT_WIDTH,
    h: m.h,
    text: m.lines.join("\n"),
    fs,
    color: theme.ink,
    bold: true,
    align: "center",
  });
  const ulY = y + m.h + 4;
  const ulW = Math.min(CONTENT_WIDTH, textWidth(text, fs) + 40);
  const ulX = left + (CONTENT_WIDTH - ulW) / 2;
  pushLine(out, { x1: ulX, y1: ulY, x2: ulX + ulW, y2: ulY, color: theme.red, strokeWidth: theme.strokeWidth });
  let consumed = m.h + 24;

  if (ir.subtitle) {
    const sub = ir.normalized.slice(ir.subtitle.start, ir.subtitle.end);
    const subFs = theme.fontSub;
    const sm = measure(sub, subFs, CONTENT_WIDTH);
    pushText(out, {
      x: left,
      y: y + consumed,
      w: CONTENT_WIDTH,
      h: sm.h,
      text: sm.lines.join("\n"),
      fs: subFs,
      color: theme.inkSoft,
      align: "center",
    });
    consumed += sm.h + 16;
  }

  return consumed + CHAIN_GAP;
}

function renderSentence(
  out: Skel[],
  ir: LogicManuscriptIR,
  theme: ThemeSpec,
  left: number,
  y: number,
  sentenceId: string,
): { height: number; bottomY: number } {
  const s = ir.sentences.find((x) => x.id === sentenceId);
  if (!s) return { height: 0, bottomY: y };

  const text = sentenceText(ir.normalized, s);
  let fs = theme.fontBody;
  let color = theme.ink;
  let bold = false;

  if (s.role === "title" || s.role === "summary") {
    fs = theme.fontSection;
    color = theme.red;
    bold = true;
  } else if (s.role === "question") {
    fs = theme.fontSub;
    bold = true;
  } else if (s.role === "step") {
    fs = theme.fontSub;
  }

  const markX = s.role === "contrast_wrong";
  const markCheck = s.role === "contrast_right";
  const indent = markX || markCheck ? 48 : 0;
  const m = measure(text, fs, CONTENT_WIDTH - indent);
  let cy = y;

  if (markX) {
    pushCross(out, left + 20, cy + glyphH(fs, 1) / 2, theme.fontSymbol, theme);
  }
  if (markCheck) {
    pushCheck(out, left + 20, cy + glyphH(fs, 1) / 2, theme.fontSymbol, theme);
  }

  pushText(out, {
    x: left + indent,
    y: cy,
    w: CONTENT_WIDTH - indent,
    h: m.h,
    text: m.lines.join("\n"),
    fs,
    color,
    bold,
  });

  if (s.role === "fork_label" || s.role === "define") {
    const pad = 12;
    pushRect(out, {
      x: left - pad,
      y: cy - pad,
      w: Math.min(CONTENT_WIDTH + pad * 2, m.w + pad * 2 + indent),
      h: m.h + pad * 2,
      stroke: theme.red,
      strokeWidth: theme.strokeWidth,
      radius: 12,
    });
  }

  for (const em of ir.emphasis) {
    if (em.kind !== "underline" || em.sentenceId !== s.id) continue;
    const sub = ir.normalized.slice(em.start, em.end);
    const idx = text.indexOf(sub);
    if (idx < 0) continue;
    const ulX = left + indent + textWidth(text.slice(0, idx), fs);
    const ulW = textWidth(sub, fs);
    const lineIdx = 0;
    const ulY = cy + lineH(fs) * (lineIdx + 1) - 6;
    pushLine(out, { x1: ulX, y1: ulY, x2: ulX + ulW, y2: ulY, color: theme.red, strokeWidth: 2 });
  }

  const bottomY = cy + m.h;
  return { height: m.h, bottomY };
}

export function layoutLecture(
  ir: LogicManuscriptIR,
  themeId: PosterTheme,
  origin: Origin,
): { elements: Skel[]; phaseBreaks: number[]; height: number } {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  const phaseBreaks: number[] = [];
  const left = origin.x + POSTER_PADDING;
  let y = origin.y + POSTER_PADDING;
  const titleSkip = new Set<string>();
  if (ir.title?.sentenceId) titleSkip.add(ir.title.sentenceId);
  if (ir.subtitle?.sentenceId) titleSkip.add(ir.subtitle.sentenceId);

  y += renderTitleBlock(out, ir, theme, left, y);

  for (let i = 0; i < ir.sentences.length; i += 1) {
    const s = ir.sentences[i];
    if (titleSkip.has(s.id)) continue;

    const stepChain = ir.chains.find((c) => c.kind === "step_list" && c.sentenceIds.includes(s.id));
    if (stepChain && stepChain.sentenceIds[0] !== s.id) continue;

    if (stepChain && stepChain.sentenceIds[0] === s.id) {
      for (const sid of stepChain.sentenceIds) {
        const { bottomY } = renderSentence(out, ir, theme, left, y, sid);
        y = bottomY + SENTENCE_GAP;
        phaseBreaks.push(out.length);
      }
      y += CHAIN_GAP - SENTENCE_GAP;
      continue;
    }

    const { bottomY } = renderSentence(out, ir, theme, left, y, s.id);
    const next = ir.sentences[i + 1];
    const edge = next ? edgeBetween(ir, s.id, next.id) : undefined;

    if (edge && !edge.deny) {
      const ax = left + CONTENT_WIDTH / 2;
      const y1 = bottomY + ARROW_GAP;
      const y2 = y1 + 28;
      pushArrow(out, { x1: ax, y1, x2: ax, y2, color: theme.ink, strokeWidth: theme.strokeWidth });
      y = y2 + ARROW_GAP;
    } else {
      y = bottomY + (edge ? SENTENCE_GAP : CHAIN_GAP);
    }

    phaseBreaks.push(out.length);
  }

  const height = Math.max(y - origin.y + POSTER_PADDING, 1920);
  void POSTER_WIDTH;
  return { elements: out, phaseBreaks, height };
}
