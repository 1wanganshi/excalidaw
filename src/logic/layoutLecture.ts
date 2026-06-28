import type { PosterTheme } from "../types";
import { CONTENT_WIDTH, POSTER_PADDING, POSTER_THEMES, POSTER_WIDTH, type ThemeSpec } from "../poster/themes";
import { sentenceText } from "./splitSentences";
import {
  parseContrastParts,
  parseFormulaChain,
  parseStepLabel,
} from "./recognize";
import { pushArrow, pushCheck, pushCross, pushLine, pushRect, pushText, type Skel } from "./draw";
import { glyphH, lineH, measure, textWidth } from "./measure";
import type { LogicEdge, LogicManuscriptIR } from "./types";

const SENTENCE_GAP = 24;
const CHAIN_GAP = 56;
const SECTION_GAP = 80;
const ARROW_GAP = 14;

type Origin = { x: number; y: number };

function edgeBetween(ir: LogicManuscriptIR, fromId: string, toId: string): LogicEdge | undefined {
  return ir.edges.find((e) => e.from === fromId && e.to === toId);
}

function findStepBlock(ir: LogicManuscriptIR, sentenceId: string) {
  return ir.chains.find((c) => c.kind === "step_block" && c.sentenceIds.includes(sentenceId));
}

function renderParagraphDivider(out: Skel[], theme: ThemeSpec, left: number, y: number): number {
  pushLine(out, {
    x1: left,
    y1: y,
    x2: left + CONTENT_WIDTH,
    y2: y,
    color: theme.ink,
    strokeWidth: 1,
  });
  return 28;
}

function renderSectionHeader(
  out: Skel[],
  theme: ThemeSpec,
  left: number,
  y: number,
  text: string,
): number {
  const fs = theme.fontSection;
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
  });
  const ulY = y + m.h + 4;
  pushLine(out, {
    x1: left,
    y1: ulY,
    x2: left + Math.min(CONTENT_WIDTH, textWidth(text, fs) + 20),
    y2: ulY,
    color: theme.red,
    strokeWidth: theme.strokeWidth - 1,
  });
  return m.h + 20;
}

function renderFormulaChainInline(
  out: Skel[],
  theme: ThemeSpec,
  left: number,
  y: number,
  parts: string[],
): number {
  const fs = theme.fontBody;
  const boxPad = 16;
  let cx = left + boxPad;
  const rowY = y + boxPad;
  let maxH = glyphH(fs, 1);

  pushRect(out, {
    x: left,
    y,
    w: CONTENT_WIDTH,
    h: maxH + boxPad * 2 + 8,
    stroke: theme.ink,
    radius: 10,
  });

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const pw = textWidth(part, fs) + 16;
    pushText(out, {
      x: cx,
      y: rowY,
      w: pw,
      h: maxH,
      text: part,
      fs,
      color: theme.ink,
      bold: true,
    });
    cx += pw;
    if (i < parts.length - 1) {
      pushText(out, {
        x: cx,
        y: rowY,
        w: 28,
        h: maxH,
        text: "→",
        fs: theme.fontSub,
        color: theme.red,
        bold: true,
      });
      cx += 28;
    }
  }

  return maxH + boxPad * 2 + 24;
}

function renderContrastInline(
  out: Skel[],
  theme: ThemeSpec,
  left: number,
  y: number,
  wrong: string,
  right: string,
): number {
  const fs = theme.fontBody;
  const indent = 48;
  const wrongM = measure(wrong, fs, CONTENT_WIDTH - indent);
  const rightM = measure(right, fs, CONTENT_WIDTH - indent);
  let cy = y;

  pushCross(out, left + 20, cy + glyphH(fs, 1) / 2, theme.fontSymbol, theme);
  pushText(out, {
    x: left + indent,
    y: cy,
    w: CONTENT_WIDTH - indent,
    h: wrongM.h,
    text: wrongM.lines.join("\n"),
    fs,
    color: theme.inkSoft,
  });
  cy += wrongM.h + 12;

  pushCheck(out, left + 20, cy + glyphH(fs, 1) / 2, theme.fontSymbol, theme);
  pushText(out, {
    x: left + indent,
    y: cy,
    w: CONTENT_WIDTH - indent,
    h: rightM.h,
    text: rightM.lines.join("\n"),
    fs,
    color: theme.ink,
    bold: true,
  });
  return wrongM.h + rightM.h + 24;
}

function renderSentenceBody(
  out: Skel[],
  ir: LogicManuscriptIR,
  theme: ThemeSpec,
  left: number,
  y: number,
  sentenceId: string,
  opts?: { inBox?: boolean; boxPad?: number },
): number {
  const s = ir.sentences.find((x) => x.id === sentenceId);
  if (!s) return 0;

  const text = sentenceText(ir.normalized, s);
  const formula = parseFormulaChain(text);
  if (formula && formula.length >= 3) {
    return renderFormulaChainInline(out, theme, left, y, formula);
  }

  const contrast = parseContrastParts(text);
  if (contrast?.wrong && contrast?.right) {
    return renderContrastInline(out, theme, left, y, contrast.wrong, contrast.right);
  }

  let fs = theme.fontBody;
  let color = theme.ink;
  let bold = false;

  if (s.role === "summary") {
    fs = theme.fontSub;
    color = theme.red;
    bold = true;
  } else if (s.role === "question") {
    fs = theme.fontSub;
    bold = true;
  }

  const markX = s.role === "contrast_wrong";
  const markCheck = s.role === "contrast_right";
  const indent = markX || markCheck ? 48 : opts?.inBox ? 8 : 0;
  const maxW = CONTENT_WIDTH - indent - (opts?.inBox ? 16 : 0);
  const m = measure(text, fs, maxW);
  let cy = y;

  if (markX) pushCross(out, left + 20, cy + glyphH(fs, 1) / 2, theme.fontSymbol, theme);
  if (markCheck) pushCheck(out, left + 20, cy + glyphH(fs, 1) / 2, theme.fontSymbol, theme);

  pushText(out, {
    x: left + indent + (opts?.inBox ? 8 : 0),
    y: cy,
    w: maxW,
    h: m.h,
    text: m.lines.join("\n"),
    fs,
    color,
    bold,
  });

  for (const em of ir.emphasis) {
    if (em.sentenceId !== s.id) continue;
    const sub = ir.normalized.slice(em.start, em.end);
    const idx = text.indexOf(sub);
    if (idx < 0) continue;
    if (em.kind === "underline" || em.kind === "red_text") {
      const ulX = left + indent + textWidth(text.slice(0, idx), fs);
      const ulW = textWidth(sub, fs);
      const ulY = cy + Math.min(m.h, lineH(fs)) - 6;
      pushLine(out, {
        x1: ulX,
        y1: ulY,
        x2: ulX + ulW,
        y2: ulY,
        color: theme.red,
        strokeWidth: em.kind === "red_text" ? 3 : 2,
      });
    }
  }

  return m.h;
}

function renderStepBlock(
  out: Skel[],
  ir: LogicManuscriptIR,
  theme: ThemeSpec,
  left: number,
  y: number,
  blockIds: string[],
): number {
  const firstText = sentenceText(ir.normalized, ir.sentences.find((s) => s.id === blockIds[0])!);
  const { label, rest } = parseStepLabel(firstText);
  const labelFs = theme.fontSection;
  const boxPad = 20;
  const innerLeft = left + boxPad + 8;

  let contentH = 0;
  if (rest) contentH += measure(rest, theme.fontBody, CONTENT_WIDTH - 40).h + SENTENCE_GAP;
  else contentH += measure(firstText, theme.fontBody, CONTENT_WIDTH - 40).h + SENTENCE_GAP;
  for (const sid of blockIds.slice(1)) {
    const t = sentenceText(ir.normalized, ir.sentences.find((s) => s.id === sid)!);
    const formula = parseFormulaChain(t);
    if (formula && formula.length >= 3) {
      contentH += glyphH(theme.fontBody, 1) + boxPad * 2 + 32 + SENTENCE_GAP;
    } else {
      contentH += measure(t, theme.fontBody, CONTENT_WIDTH - 40).h + SENTENCE_GAP;
    }
  }

  const labelH = glyphH(labelFs, 1) + 8;
  const boxY = y + labelH;
  const boxH = contentH + boxPad * 2;

  pushText(out, {
    x: left,
    y,
    w: textWidth(label, labelFs) + 8,
    h: glyphH(labelFs, 1),
    text: label,
    fs: labelFs,
    color: theme.red,
    bold: true,
  });

  pushRect(out, {
    x: left,
    y: boxY,
    w: CONTENT_WIDTH,
    h: boxH,
    stroke: theme.ink,
    strokeWidth: theme.strokeWidth,
    radius: 14,
  });
  pushLine(out, {
    x1: left + 6,
    y1: boxY + 12,
    x2: left + 6,
    y2: boxY + boxH - 12,
    color: theme.red,
    strokeWidth: 4,
  });

  let innerY = boxY + boxPad;
  if (rest) {
    const m = measure(rest, theme.fontBody, CONTENT_WIDTH - 40);
    pushText(out, {
      x: innerLeft,
      y: innerY,
      w: CONTENT_WIDTH - 40,
      h: m.h,
      text: m.lines.join("\n"),
      fs: theme.fontBody,
      color: theme.ink,
      bold: true,
    });
    innerY += m.h + SENTENCE_GAP;
  }
  for (const sid of blockIds.slice(1)) {
    const prevIdx = blockIds.indexOf(sid) - 1;
    const prevId = blockIds[prevIdx];
    const prevS = ir.sentences.find((s) => s.id === prevId);
    const curS = ir.sentences.find((s) => s.id === sid)!;
    const edge = edgeBetween(ir, prevId, sid);
    if (edge && prevS?.role === "question") {
      const ax = innerLeft + 20;
      pushArrow(out, {
        x1: ax,
        y1: innerY - SENTENCE_GAP + 4,
        x2: ax,
        y2: innerY - 4,
        color: theme.red,
        strokeWidth: 2,
      });
    }
    innerY += renderSentenceBody(out, ir, theme, innerLeft, innerY, sid, { inBox: true });
    innerY += SENTENCE_GAP;
  }

  return labelH + boxH + 24;
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
  const rendered = new Set<string>();

  if (ir.title) {
    const titleText = sentenceText(ir.normalized, ir.sentences.find((s) => s.id === ir.title!.sentenceId)!);
    y += renderSectionHeader(out, theme, left, y, titleText) + SECTION_GAP;
    rendered.add(ir.title.sentenceId!);
    if (ir.subtitle?.sentenceId) rendered.add(ir.subtitle.sentenceId);
  }

  for (let i = 0; i < ir.sentences.length; i += 1) {
    const s = ir.sentences[i];
    if (rendered.has(s.id)) continue;

    const stepBlock = findStepBlock(ir, s.id);
    if (stepBlock && stepBlock.sentenceIds[0] === s.id) {
      if (s.paragraphStart) y += renderParagraphDivider(out, theme, left, y);
      y += renderStepBlock(out, ir, theme, left, y, stepBlock.sentenceIds);
      for (const id of stepBlock.sentenceIds) rendered.add(id);
      phaseBreaks.push(out.length);

      const lastId = stepBlock.sentenceIds[stepBlock.sentenceIds.length - 1];
      const next = ir.sentences[i + stepBlock.sentenceIds.length];
      const edge = next ? edgeBetween(ir, lastId, next.id) : undefined;
      if (edge && !edge.deny) {
        const ax = left + CONTENT_WIDTH / 2;
        pushArrow(out, { x1: ax, y1: y + ARROW_GAP, x2: ax, y2: y + ARROW_GAP + 28, color: theme.ink });
        y += ARROW_GAP + 28 + ARROW_GAP;
      } else {
        y += CHAIN_GAP;
      }
      continue;
    }
    if (stepBlock) continue;

    if (s.paragraphStart) {
      y += renderParagraphDivider(out, theme, left, y);
    }

    const text = sentenceText(ir.normalized, s);

    if (s.role === "section") {
      y += renderSectionHeader(out, theme, left, y, text);
      rendered.add(s.id);
      phaseBreaks.push(out.length);
      const next = ir.sentences[i + 1];
      const edge = next ? edgeBetween(ir, s.id, next.id) : undefined;
      if (edge && !edge.deny) {
        const ax = left + CONTENT_WIDTH / 2;
        pushArrow(out, { x1: ax, y1: y + ARROW_GAP, x2: ax, y2: y + ARROW_GAP + 28, color: theme.ink });
        y += ARROW_GAP + 28 + ARROW_GAP;
      } else {
        y += SECTION_GAP / 2;
      }
      continue;
    }

    const h = renderSentenceBody(out, ir, theme, left, y, s.id);
    y += h;
    rendered.add(s.id);
    phaseBreaks.push(out.length);

    const next = ir.sentences[i + 1];
    const edge = next && !rendered.has(next.id) ? edgeBetween(ir, s.id, next.id) : undefined;
    if (edge && !edge.deny && next && !findStepBlock(ir, next.id)) {
      const ax = left + CONTENT_WIDTH / 2;
      pushArrow(out, { x1: ax, y1: y + ARROW_GAP, x2: ax, y2: y + ARROW_GAP + 28, color: theme.ink });
      y += ARROW_GAP + 28 + ARROW_GAP;
    } else {
      y += next?.paragraphStart ? CHAIN_GAP : SENTENCE_GAP;
    }
  }

  const height = Math.max(y - origin.y + POSTER_PADDING, 1920);
  void POSTER_WIDTH;
  return { elements: out, phaseBreaks, height };
}
