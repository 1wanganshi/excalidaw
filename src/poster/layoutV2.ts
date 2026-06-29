/**
 * V2 layout pipeline — Visual Design Overhaul.
 *
 * Features:
 *   - Theme-aware decorations (badges, stripes, filled backgrounds)
 *   - Dynamic rhythm (breathing gaps, deceleration curve)
 *   - Dual-column layout for short contrast cards
 *   - Drop-cap for long paragraphs (magazine / minimal)
 *   - Breathing decorators between sections
 *   - Per-theme visual personality
 *
 * Streaming-friendly: every section can be rendered independently.
 */
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  PatternCaseBox,
  PatternCentralNegation,
  PatternContrastCard,
  PatternFormulaChain,
  PatternFreeParagraph,
  PatternHighlight,
  PatternSceneWithQuotes,
  PatternSummary,
  PatternTripletCircles,
  PatternTripletList,
  PosterDocumentV2,
  PosterSection,
  PosterTheme,
  SectionPattern,
} from "../types";
import {
  CONTENT_WIDTH,
  POSTER_PADDING,
  POSTER_THEMES,
  POSTER_WIDTH,
  type ThemeSpec,
} from "./themes";

type Skel = ExcalidrawElementSkeleton;
type Origin = { x: number; y: number };

// ============================================================
// Primitives
// ============================================================

function pushText(
  out: Skel[],
  o: {
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    fs: number;
    color: string;
    bold?: boolean;
    align?: "left" | "center" | "right";
    valign?: "top" | "middle" | "bottom";
  },
) {
  out.push({
    type: "text",
    x: o.x,
    y: o.y,
    width: o.w,
    height: o.h,
    text: o.text,
    fontSize: o.fs,
    fontFamily: 1,
    textAlign: o.align ?? "left",
    verticalAlign: o.valign ?? "top",
    strokeColor: o.color,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.bold ? 2 : 1,
    roughness: 0,
    opacity: 100,
  } as Skel);
}

function pushRect(
  out: Skel[],
  o: {
    x: number;
    y: number;
    w: number;
    h: number;
    stroke: string;
    fill?: string;
    strokeWidth?: number;
    radius?: number;
    roughness?: 0 | 1 | 2;
    opacity?: number;
  },
) {
  out.push({
    type: "rectangle",
    x: o.x,
    y: o.y,
    width: o.w,
    height: o.h,
    strokeColor: o.stroke,
    backgroundColor: o.fill ?? "transparent",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth ?? 3,
    roughness: o.roughness ?? 2,
    opacity: o.opacity ?? 100,
    roundness: (o.radius ?? 0) > 0 ? { type: 3 } : null,
  } as Skel);
}

function pushEllipse(
  out: Skel[],
  o: { x: number; y: number; w: number; h: number; stroke: string; fill?: string; strokeWidth?: number; roughness?: 0 | 1 | 2 },
) {
  out.push({
    type: "ellipse",
    x: o.x,
    y: o.y,
    width: o.w,
    height: o.h,
    strokeColor: o.stroke,
    backgroundColor: o.fill ?? "transparent",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth ?? 4,
    roughness: o.roughness ?? 2,
    opacity: 100,
  } as Skel);
}

function pushLine(
  out: Skel[],
  o: { x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth?: number; dashed?: boolean; roughness?: 0 | 1 | 2 },
) {
  out.push({
    type: "line",
    x: o.x1,
    y: o.y1,
    width: o.x2 - o.x1,
    height: o.y2 - o.y1,
    points: [
      [0, 0],
      [o.x2 - o.x1, o.y2 - o.y1],
    ],
    strokeColor: o.color,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeStyle: o.dashed ? "dashed" : "solid",
    strokeWidth: o.strokeWidth ?? 3,
    roughness: o.roughness ?? 2,
    opacity: 100,
  } as Skel);
}

function pushArrow(
  out: Skel[],
  o: { x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth?: number; roughness?: 0 | 1 | 2 },
) {
  const dx = o.x2 - o.x1;
  const dy = o.y2 - o.y1;
  out.push({
    type: "arrow",
    x: o.x1,
    y: o.y1,
    width: dx,
    height: dy,
    points: [
      [0, 0],
      [dx, dy],
    ],
    strokeColor: o.color,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth ?? 3,
    roughness: o.roughness ?? 2,
    opacity: 100,
    endArrowhead: "arrow",
    startArrowhead: null,
  } as unknown as Skel);
}

function pushCross(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  pushLine(out, { x1: cx - h, y1: cy - h, x2: cx + h, y2: cy + h, color: theme.red, strokeWidth: theme.strokeWidth + 1, roughness: theme.roughness });
  pushLine(out, { x1: cx - h, y1: cy + h, x2: cx + h, y2: cy - h, color: theme.red, strokeWidth: theme.strokeWidth + 1, roughness: theme.roughness });
}

function pushCheck(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  pushLine(out, { x1: cx - h, y1: cy + 2, x2: cx - h / 3, y2: cy + h - 4, color: theme.green, strokeWidth: theme.strokeWidth + 1, roughness: theme.roughness });
  pushLine(out, { x1: cx - h / 3, y1: cy + h - 4, x2: cx + h, y2: cy - h, color: theme.green, strokeWidth: theme.strokeWidth + 1, roughness: theme.roughness });
}

// ============================================================
// Text measurement
// ============================================================

function charWidth(ch: string, fs: number): number {
  const code = ch.charCodeAt(0);
  if (/\s/.test(ch)) return fs * 0.35;
  if (code > 0x7f) return fs * 1.08;
  if (/[A-Z0-9]/.test(ch)) return fs * 0.68;
  if (".,:;!?|/\\()[]{}'\"`~-\u2013\u2014_+=<>".includes(ch)) return fs * 0.46;
  return fs * 0.62;
}

function textWidth(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, fs);
  return w;
}

function wrap(text: string, fs: number, maxW: number): string[] {
  if (!text) return [""];
  const safe = Math.max(fs * 2, maxW * 0.92);
  const noLineStart = "\u3002\uff0c\u3001\uff1b\uff1a\uff01\uff1f\uff09\u300d\u300f\u3011\u3017\u300b\u3015\u2026\u2014\u00b7\uff0e,.;:!?)]}";
  const noLineEnd = "\u300c\u300e\uff08\u3016\u300a\u3014\u3010([{";
  const isNoStart = (ch: string) => noLineStart.includes(ch);
  const isNoEnd = (ch: string) => noLineEnd.includes(ch);
  const raw: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para.length) { raw.push(""); continue; }
    let cur = "";
    let curW = 0;
    let i = 0;
    while (i < para.length) {
      const ch = para[i];
      let chunk = ch;
      let cw: number;
      if (ch.charCodeAt(0) <= 0x7f && ch !== " ") {
        let j = i;
        while (j < para.length) {
          const nc = para[j];
          if (nc.charCodeAt(0) > 0x7f || nc === " ") break;
          j += 1;
        }
        chunk = para.slice(i, j);
        cw = textWidth(chunk, fs);
        i = j;
      } else {
        cw = charWidth(ch, fs);
        i += 1;
      }
      if (cw > safe) {
        for (const part of chunk) {
          const pw = charWidth(part, fs);
          if (curW + pw > safe && cur.length > 0) { raw.push(cur); cur = part; curW = pw; }
          else { cur += part; curW += pw; }
        }
        continue;
      }
      if (curW + cw > safe && cur.length > 0) {
        raw.push(cur.trimEnd());
        cur = chunk.trimStart();
        curW = textWidth(cur, fs);
      } else { cur += chunk; curW += cw; }
    }
    if (cur.length > 0) raw.push(cur.trimEnd());
    else raw.push("");
  }
  const out: string[] = [];
  for (let li = 0; li < raw.length; li += 1) {
    let line = raw[li];
    while (line.length > 0 && out.length > 0 && isNoStart(line[0])) {
      out[out.length - 1] = out[out.length - 1] + line[0];
      line = line.slice(1);
    }
    while (line.length > 1 && isNoEnd(line[line.length - 1]) && li + 1 < raw.length) {
      raw[li + 1] = line[line.length - 1] + raw[li + 1];
      line = line.slice(0, -1);
    }
    out.push(line);
  }
  return out.length > 0 ? out : [""];
}

function lineH(fs: number) { return Math.round(fs * 1.68); }
function glyphH(fs: number, lines: number) { return Math.round(fs * 1.25 * Math.max(1, lines)); }

function measure(text: string, fs: number, maxW: number) {
  const lines = wrap(text, fs, maxW);
  const h = lineH(fs) * lines.length;
  let maxLine = 0;
  for (const l of lines) { const w = textWidth(l, fs); if (w > maxLine) maxLine = w; }
  return { lines, w: Math.min(maxLine, maxW), h };
}

function pushCenteredText(
  out: Skel[],
  o: { boxX: number; boxY: number; boxW: number; boxH: number; lines: string[]; fs: number; color: string; bold?: boolean },
) {
  const maxLineW = Math.max(...o.lines.map((l) => textWidth(l, o.fs)));
  const x = o.boxX + (o.boxW - maxLineW) / 2;
  const gh = glyphH(o.fs, o.lines.length);
  const y = o.boxY + (o.boxH - gh) / 2;
  pushText(out, { x, y, w: Math.ceil(maxLineW) + 8, h: gh, text: o.lines.join("\n"), fs: o.fs, color: o.color, bold: o.bold, align: "left" });
}

// ============================================================
// Decoration helpers
// ============================================================

/** Section badge: circle / square / pill containing the section number */
function pushSectionBadge(
  out: Skel[],
  x: number,
  y: number,
  no: number,
  theme: ThemeSpec,
): { width: number } {
  const style = theme.sectionBadge;
  if (style === "none") return { width: 0 };

  const fs = theme.fontMeta;
  const label = String(no).padStart(2, "0");
  const badgeSize = Math.round(fs * 1.8);

  if (style === "circle") {
    pushEllipse(out, { x, y, w: badgeSize, h: badgeSize, stroke: theme.red, fill: theme.red, strokeWidth: 0, roughness: theme.roughness });
    pushCenteredText(out, { boxX: x, boxY: y, boxW: badgeSize, boxH: badgeSize, lines: [label], fs: fs - 2, color: theme.paper, bold: true });
    return { width: badgeSize + 14 };
  }

  if (style === "square") {
    const r = 6;
    pushRect(out, { x, y, w: badgeSize, h: badgeSize, stroke: theme.accent, fill: theme.accent, strokeWidth: 0, radius: r, roughness: theme.roughness });
    pushCenteredText(out, { boxX: x, boxY: y, boxW: badgeSize, boxH: badgeSize, lines: [label], fs: fs - 2, color: theme.paper, bold: true });
    return { width: badgeSize + 14 };
  }

  // pill
  const pillW = textWidth(label, fs) + 24;
  const pillH = badgeSize - 6;
  pushRect(out, { x, y: y + 3, w: pillW, h: pillH, stroke: theme.red, fill: theme.red, strokeWidth: 0, radius: Math.round(pillH / 2), roughness: theme.roughness });
  pushCenteredText(out, { boxX: x, boxY: y + 3, boxW: pillW, boxH: pillH, lines: [label], fs: fs - 4, color: theme.paper, bold: true });
  return { width: pillW + 14 };
}

/** Vertical accent stripe beside section header */
function pushSectionStripe(out: Skel[], x: number, y: number, h: number, theme: ThemeSpec) {
  if (!theme.sectionStripe) return;
  const w = 5;
  pushRect(out, { x, y, w, h, stroke: theme.accent, fill: theme.accent, strokeWidth: 0, radius: 3, roughness: 0 });
}

/** Breathing decorator between sections */
function pushBreathingDecor(out: Skel[], left: number, y: number, width: number, theme: ThemeSpec): number {
  const style = theme.breathingDecor;
  if (style === "none") return 0;

  const cy = y;
  const cx = left + width / 2;

  if (style === "dots") {
    const dotR = 4;
    const gap = 24;
    for (let i = -1; i <= 1; i += 1) {
      pushEllipse(out, { x: cx + i * gap - dotR, y: cy - dotR, w: dotR * 2, h: dotR * 2, stroke: theme.inkSoft, fill: theme.inkSoft, strokeWidth: 0, roughness: 0 });
    }
    return 24;
  }

  if (style === "line") {
    const lineW = Math.min(width * 0.4, 320);
    pushLine(out, { x1: cx - lineW / 2, y1: cy, x2: cx + lineW / 2, y2: cy, color: theme.inkSoft, strokeWidth: 1, dashed: false, roughness: 0 });
    return 20;
  }

  // wave
  const waveW = Math.min(width * 0.35, 280);
  const startX = cx - waveW / 2;
  pushLine(out, { x1: startX, y1: cy, x2: startX + waveW * 0.33, y2: cy - 6, color: theme.inkSoft, strokeWidth: 2, roughness: 2 });
  pushLine(out, { x1: startX + waveW * 0.33, y1: cy - 6, x2: startX + waveW * 0.66, y2: cy + 6, color: theme.inkSoft, strokeWidth: 2, roughness: 2 });
  pushLine(out, { x1: startX + waveW * 0.66, y1: cy + 6, x2: startX + waveW, y2: cy, color: theme.inkSoft, strokeWidth: 2, roughness: 2 });
  return 28;
}

// ============================================================
// Dynamic rhythm
// ============================================================

function computeSectionGap(
  theme: ThemeSpec,
  sectionIndex: number,
  totalSections: number,
  _prevSection: PosterSection | undefined,
  nextSection: PosterSection | undefined,
): number {
  let gap = theme.sectionGap;

  // First section gets hero gap
  if (sectionIndex === 0) return theme.heroGap;

  // Summary sections need more breathing room before them
  const nextHasSummary = nextSection?.body.some((p) => p.pattern === "summary");
  if (nextHasSummary) gap = Math.round(gap * 1.4);

  // Deceleration curve: gaps grow slightly toward the end
  const progress = totalSections > 1 ? sectionIndex / (totalSections - 1) : 0;
  if (progress > 0.7) gap = Math.round(gap * (1 + (progress - 0.7) * 0.4));

  return gap;
}

function computePatternGap(
  theme: ThemeSpec,
  prevPattern: SectionPattern | undefined,
  nextPattern: SectionPattern | undefined,
): number {
  let gap = theme.patternGap;

  if (!prevPattern || !nextPattern) return gap;

  // Consecutive free_paragraph: tighter
  if (prevPattern.pattern === "free_paragraph" && nextPattern.pattern === "free_paragraph") {
    return Math.round(gap * 0.7);
  }

  // Before highlight: more space
  if (nextPattern.pattern === "highlight") return Math.round(gap * 1.3);

  // After case_box or contrast_card: more space
  if (prevPattern.pattern === "case_box" || prevPattern.pattern === "contrast_card") {
    return Math.round(gap * 1.2);
  }

  return gap;
}

// ============================================================
// Section header
// ============================================================

function renderSectionHeader(
  out: Skel[],
  left: number,
  yCursor: number,
  s: PosterSection,
  theme: ThemeSpec,
): number {
  if (!s.label) return 0;

  const fs = theme.fontSection;
  const label = s.label;
  let xOffset = left;
  let totalH = 0;

  // Badge
  if (s.no && theme.sectionBadge !== "none") {
    const badgeY = yCursor + 2;
    const { width: badgeW } = pushSectionBadge(out, xOffset, badgeY, s.no, theme);
    xOffset += badgeW;
  } else if (s.no) {
    const cnNums = ["\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d", "\u4e03", "\u516b", "\u4e5d", "\u5341"];
    const numPrefix = `${cnNums[s.no - 1] ?? s.no}\u3001`;
    const numW = textWidth(numPrefix, fs);
    pushText(out, { x: xOffset, y: yCursor, w: numW + 4, h: glyphH(fs, 1), text: numPrefix, fs, color: theme.red, bold: true });
    xOffset += numW;
  }

  // Stripe (vertical accent bar to the left of the label)
  if (theme.sectionStripe) {
    const stripeH = Math.round(fs * 1.3);
    pushSectionStripe(out, left - 12, yCursor, stripeH, theme);
  }

  // Label text
  const availW = CONTENT_WIDTH - (xOffset - left);
  const m = measure(label, fs, availW);
  pushText(out, { x: xOffset, y: yCursor, w: availW, h: m.h, text: m.lines.join("\n"), fs, color: theme.ink, bold: true });
  totalH = m.h;

  // Underline accent below label
  const ulY = yCursor + totalH + 4;
  const ulW = Math.min(m.w + 20, availW);
  pushLine(out, { x1: xOffset, y1: ulY, x2: xOffset + ulW, y2: ulY, color: theme.red, strokeWidth: theme.strokeWidth, roughness: theme.roughness });

  return totalH + 16;
}

// ============================================================
// Pattern renderers
// ============================================================

function splitSentences(text: string): string[] {
  const segs: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if ("\u3002\uff01\uff1f!?\uff1b;".includes(ch)) { segs.push(buf); buf = ""; }
  }
  if (buf.trim().length > 0) segs.push(buf);
  return segs.map((s) => s.trim()).filter((s) => s.length > 0);
}

function patternFreeParagraph(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternFreeParagraph,
  theme: ThemeSpec,
): number {
  const fs = theme.fontBody;
  const text = p.text ?? "";
  const compact = text.replace(/\s+/g, "");
  const color = p.emphasis === "red" ? theme.red : theme.ink;

  // Short red emphasis text
  if (p.emphasis === "red" || compact.length <= 60) {
    const m = measure(text, fs, CONTENT_WIDTH);
    pushText(out, { x: left, y: yCursor, w: CONTENT_WIDTH, h: m.h, text: m.lines.join("\n"), fs, color, bold: p.emphasis === "red" });
    return m.h;
  }

  // Drop cap for long paragraphs (magazine/minimal style)
  if (theme.dropCap && compact.length > 80 && text.length > 0) {
    return renderDropCapParagraph(out, left, yCursor, text, fs, theme);
  }

  // Long text: split by sentences for reading rhythm
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    const m = measure(text, fs, CONTENT_WIDTH);
    pushText(out, { x: left, y: yCursor, w: CONTENT_WIDTH, h: m.h, text: m.lines.join("\n"), fs, color, bold: false });
    return m.h;
  }

  const sentenceGap = 14;
  let cursor = yCursor;
  for (const s of sentences) {
    const m = measure(s, fs, CONTENT_WIDTH);
    pushText(out, { x: left, y: cursor, w: CONTENT_WIDTH, h: m.h, text: m.lines.join("\n"), fs, color, bold: false });
    cursor += m.h + sentenceGap;
  }
  return cursor - yCursor - sentenceGap;
}

function renderDropCapParagraph(
  out: Skel[],
  left: number,
  yCursor: number,
  text: string,
  fs: number,
  theme: ThemeSpec,
): number {
  const firstChar = text[0];
  const rest = text.slice(1);
  const dcFs = Math.round(fs * 2.2);
  const dcW = charWidth(firstChar, dcFs) + 8;
  const dcH = glyphH(dcFs, 1);

  // Drop cap character
  pushText(out, { x: left, y: yCursor - 4, w: dcW, h: dcH, text: firstChar, fs: dcFs, color: theme.accent, bold: true });

  // Rest of the text wraps around the drop cap
  const indentW = dcW + 8;
  const firstLineW = CONTENT_WIDTH - indentW;
  const firstLines = wrap(rest, fs, firstLineW);

  // How many lines fit beside the drop cap
  const dcLines = Math.ceil(dcH / lineH(fs));
  const besideLines = firstLines.slice(0, dcLines);
  const afterLines = firstLines.slice(dcLines);

  let cursor = yCursor;

  if (besideLines.length > 0) {
    const besideH = lineH(fs) * besideLines.length;
    pushText(out, { x: left + indentW, y: cursor, w: firstLineW, h: besideH, text: besideLines.join("\n"), fs, color: theme.ink });
    cursor += besideH;
  }

  if (afterLines.length > 0) {
    // Re-wrap the remaining text at full width
    const remainingText = afterLines.join("");
    const m = measure(remainingText, fs, CONTENT_WIDTH);
    pushText(out, { x: left, y: cursor, w: CONTENT_WIDTH, h: m.h, text: m.lines.join("\n"), fs, color: theme.ink });
    cursor += m.h;
  }

  return Math.max(cursor - yCursor, dcH);
}

function patternCentralNegation(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternCentralNegation,
  theme: ThemeSpec,
): number {
  const fsCore = theme.fontSection;
  const fsOpt = theme.fontBody;
  const optPadX = 18;
  const optPadY = 10;
  const optH = lineH(fsOpt) + optPadY * 2;
  const optGap = 24;
  const blockH = p.options.length * optH + (p.options.length - 1) * optGap;
  const coreW = textWidth(p.center, fsCore) + 12;
  const coreY = yCursor + blockH / 2 - glyphH(fsCore, 1) / 2;

  pushText(out, { x: left + 10, y: coreY, w: coreW, h: glyphH(fsCore, 1), text: p.center, fs: fsCore, color: theme.ink, bold: true });

  const fanFromX = left + 10 + coreW + 16;
  const optStartX = left + CONTENT_WIDTH - 320;

  for (let i = 0; i < p.options.length; i += 1) {
    const optW = textWidth(p.options[i], fsOpt) + optPadX * 2;
    const y = yCursor + i * (optH + optGap);
    pushRect(out, { x: optStartX, y, w: optW, h: optH, stroke: theme.ink, fill: theme.cardFill, strokeWidth: theme.strokeWidth - 1, radius: 8, roughness: theme.roughness });
    pushCenteredText(out, { boxX: optStartX, boxY: y, boxW: optW, boxH: optH, lines: [p.options[i]], fs: fsOpt, color: theme.ink, bold: true });
    pushLine(out, { x1: fanFromX, y1: yCursor + blockH / 2, x2: optStartX - 8, y2: y + optH / 2, color: theme.inkSoft, strokeWidth: theme.strokeWidth - 1, roughness: theme.roughness });
  }

  // Big X overlay
  const crossCx = (fanFromX + optStartX) / 2;
  const crossCy = yCursor + blockH / 2;
  const crossSize = Math.min(blockH * 0.6, 120);
  pushCross(out, crossCx, crossCy, crossSize, theme);

  return blockH;
}

function patternTripletCircles(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternTripletCircles,
  theme: ThemeSpec,
): number {
  const items = p.items.filter((s) => s && s.length > 0);
  if (items.length === 0) return 0;
  const fs = theme.fontSub;
  let maxLabel = 0;
  for (const it of items) maxLabel = Math.max(maxLabel, textWidth(it, fs));
  const d = Math.min(Math.max(150, maxLabel + 56), 200);
  const plusW = 64;
  const totalW = items.length * d + (items.length - 1) * plusW;
  const startX = Math.max(left, left + (CONTENT_WIDTH - totalW) / 2);
  const cy = yCursor + d / 2;

  for (let i = 0; i < items.length; i += 1) {
    const cx = startX + i * (d + plusW) + d / 2;
    pushEllipse(out, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, stroke: theme.ink, strokeWidth: theme.strokeWidth + 1, roughness: theme.roughness });
    pushCenteredText(out, { boxX: cx - d / 2, boxY: cy - d / 2, boxW: d, boxH: d, lines: [items[i]], fs, color: theme.ink, bold: true });
    if (i < items.length - 1) {
      const plusCx = cx + d / 2 + plusW / 2;
      pushCenteredText(out, { boxX: plusCx - 16, boxY: cy - 22, boxW: 32, boxH: 44, lines: ["+"], fs: theme.fontSection, color: theme.accent, bold: true });
    }
  }
  return d;
}

function patternContrastCard(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternContrastCard,
  theme: ThemeSpec,
): number {
  const fs = theme.fontBody;
  const innerW = CONTENT_WIDTH - 110;

  // Check if short enough for side-by-side dual-column layout
  const wrongCompact = (p.wrong ?? "").replace(/\s+/g, "").length;
  const rightCompact = (p.right ?? "").replace(/\s+/g, "").length;
  if (wrongCompact <= 30 && rightCompact <= 30 && wrongCompact > 0 && rightCompact > 0) {
    return renderContrastDualColumn(out, left, yCursor, p, theme);
  }

  const wrongM = measure(p.wrong, fs, innerW);
  const rightM = measure(p.right, fs, innerW);
  const rowH = (lines: number) => Math.max(lineH(fs) * lines, theme.fontSymbol + 8);
  const wrongH = rowH(wrongM.lines.length);
  const rightH = rowH(rightM.lines.length);
  const divider = 24;
  const padX = 40;
  const padY = 28;
  const innerH = wrongH + divider + rightH;
  const boxH = innerH + padY * 2;

  // Outer card
  pushRect(out, { x: left, y: yCursor, w: CONTENT_WIDTH, h: boxH, stroke: theme.ink, fill: theme.cardFill, strokeWidth: theme.strokeWidth + 1, radius: 20, roughness: theme.roughness });

  // Wrong section background tint
  pushRect(out, { x: left + 8, y: yCursor + padY - 8, w: CONTENT_WIDTH - 16, h: wrongH + 16, stroke: "transparent", fill: theme.wrongFill, strokeWidth: 0, radius: 12, roughness: 0, opacity: 80 });

  // Wrong row
  const wrongRowY = yCursor + padY;
  pushCross(out, left + padX + theme.fontSymbol / 2, wrongRowY + wrongH / 2, theme.fontSymbol, theme);
  const wrongTextX = left + padX + theme.fontSymbol + 18;
  pushText(out, { x: wrongTextX, y: wrongRowY + (wrongH - glyphH(fs, wrongM.lines.length)) / 2, w: CONTENT_WIDTH - padX * 2 - theme.fontSymbol - 18, h: glyphH(fs, wrongM.lines.length), text: wrongM.lines.join("\n"), fs, color: theme.ink, bold: true });

  // Divider
  const divY = wrongRowY + wrongH + divider / 2;
  pushLine(out, { x1: left + padX, y1: divY, x2: left + CONTENT_WIDTH - padX, y2: divY, color: theme.inkSoft, strokeWidth: 1, dashed: true, roughness: 0 });

  // Right section background tint
  const rightRowY = wrongRowY + wrongH + divider;
  pushRect(out, { x: left + 8, y: rightRowY - 8, w: CONTENT_WIDTH - 16, h: rightH + 16, stroke: "transparent", fill: theme.rightFill, strokeWidth: 0, radius: 12, roughness: 0, opacity: 80 });

  // Right row
  pushCheck(out, left + padX + theme.fontSymbol / 2, rightRowY + rightH / 2, theme.fontSymbol, theme);
  pushText(out, { x: wrongTextX, y: rightRowY + (rightH - glyphH(fs, rightM.lines.length)) / 2, w: CONTENT_WIDTH - padX * 2 - theme.fontSymbol - 18, h: glyphH(fs, rightM.lines.length), text: rightM.lines.join("\n"), fs, color: theme.ink, bold: true });

  return boxH;
}

/** Dual-column contrast: wrong on left, right on right, side by side */
function renderContrastDualColumn(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternContrastCard,
  theme: ThemeSpec,
): number {
  const fs = theme.fontBody;
  const colGap = 24;
  const colW = (CONTENT_WIDTH - colGap) / 2;
  const padX = 20;
  const padY = 24;
  const innerW = colW - padX * 2 - theme.fontSymbol - 12;

  const wrongM = measure(p.wrong, fs, innerW);
  const rightM = measure(p.right, fs, innerW);
  const contentH = Math.max(wrongM.h, rightM.h);
  const boxH = contentH + padY * 2;

  // Wrong column
  pushRect(out, { x: left, y: yCursor, w: colW, h: boxH, stroke: theme.red, fill: theme.wrongFill, strokeWidth: theme.strokeWidth, radius: 14, roughness: theme.roughness });
  const wrongCenterY = yCursor + boxH / 2;
  pushCross(out, left + padX + theme.fontSymbol / 2, wrongCenterY, theme.fontSymbol * 0.7, theme);
  pushText(out, { x: left + padX + theme.fontSymbol + 12, y: yCursor + padY, w: innerW, h: wrongM.h, text: wrongM.lines.join("\n"), fs, color: theme.ink, bold: true });

  // Right column
  const rightX = left + colW + colGap;
  pushRect(out, { x: rightX, y: yCursor, w: colW, h: boxH, stroke: theme.green, fill: theme.rightFill, strokeWidth: theme.strokeWidth, radius: 14, roughness: theme.roughness });
  const rightCenterY = yCursor + boxH / 2;
  pushCheck(out, rightX + padX + theme.fontSymbol / 2, rightCenterY, theme.fontSymbol * 0.7, theme);
  pushText(out, { x: rightX + padX + theme.fontSymbol + 12, y: yCursor + padY, w: innerW, h: rightM.h, text: rightM.lines.join("\n"), fs, color: theme.ink, bold: true });

  return boxH;
}

function patternFormulaChain(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternFormulaChain,
  theme: ThemeSpec,
): number {
  const items = p.items.filter((s) => s && s.length > 0);
  if (items.length === 0) return 0;
  const fs = theme.fontSub;
  const padX = 26;
  const padY = 16;
  const arrowGap = 40;
  const sizes = items.map((t) => {
    const w = textWidth(t, fs) + padX * 2;
    return { w: Math.min(Math.max(w, 130), CONTENT_WIDTH * 0.45), h: lineH(fs) + padY * 2 };
  });
  const totalW = sizes.reduce((s, it) => s + it.w, 0) + arrowGap * (sizes.length - 1);

  // Single row if fits
  if (totalW <= CONTENT_WIDTH) {
    let x = left + (CONTENT_WIDTH - totalW) / 2;
    const maxH = Math.max(...sizes.map((s) => s.h));
    const cy = yCursor + maxH / 2;
    for (let i = 0; i < items.length; i += 1) {
      const s = sizes[i];
      const y = yCursor + (maxH - s.h) / 2;
      pushRect(out, { x, y, w: s.w, h: s.h, stroke: theme.ink, fill: theme.cardFill, strokeWidth: theme.strokeWidth, radius: 12, roughness: theme.roughness });
      pushCenteredText(out, { boxX: x, boxY: y, boxW: s.w, boxH: s.h, lines: [items[i]], fs, color: theme.ink, bold: true });
      if (i < items.length - 1) {
        pushArrow(out, { x1: x + s.w + 4, y1: cy, x2: x + s.w + arrowGap - 4, y2: cy, color: theme.accent, strokeWidth: theme.strokeWidth, roughness: theme.roughness });
      }
      x += s.w + arrowGap;
    }
    return maxH;
  }

  // Two-row grid for many items
  if (items.length >= 4) {
    return renderFormulaGrid(out, left, yCursor, items, fs, theme);
  }

  // Vertical stack
  let cursor = yCursor;
  const cx = left + CONTENT_WIDTH / 2;
  for (let i = 0; i < items.length; i += 1) {
    const s = sizes[i];
    const bx = cx - s.w / 2;
    pushRect(out, { x: bx, y: cursor, w: s.w, h: s.h, stroke: theme.ink, fill: theme.cardFill, strokeWidth: theme.strokeWidth, radius: 12, roughness: theme.roughness });
    pushCenteredText(out, { boxX: bx, boxY: cursor, boxW: s.w, boxH: s.h, lines: [items[i]], fs, color: theme.ink, bold: true });
    if (i < items.length - 1) {
      pushArrow(out, { x1: cx, y1: cursor + s.h + 4, x2: cx, y2: cursor + s.h + arrowGap - 4, color: theme.accent, strokeWidth: theme.strokeWidth, roughness: theme.roughness });
    }
    cursor += s.h + arrowGap;
  }
  return cursor - yCursor - arrowGap;
}

function renderFormulaGrid(
  out: Skel[],
  left: number,
  yCursor: number,
  items: string[],
  fs: number,
  theme: ThemeSpec,
): number {
  const cols = Math.ceil(items.length / 2);
  const padX = 20;
  const padY = 14;
  const hGap = 32;
  const vGap = 36;
  const colW = (CONTENT_WIDTH - hGap * (cols - 1)) / cols;
  const cellH = lineH(fs) + padY * 2;

  let cursor = yCursor;
  for (let row = 0; row < 2; row += 1) {
    let x = left;
    for (let col = 0; col < cols; col += 1) {
      const idx = row * cols + col;
      if (idx >= items.length) break;
      pushRect(out, { x, y: cursor, w: colW, h: cellH, stroke: theme.ink, fill: theme.cardFill, strokeWidth: theme.strokeWidth, radius: 10, roughness: theme.roughness });
      pushCenteredText(out, { boxX: x, boxY: cursor, boxW: colW, boxH: cellH, lines: [items[idx]], fs, color: theme.ink, bold: true });
      // Horizontal arrow
      if (col < cols - 1 && (idx + 1) < items.length) {
        pushArrow(out, { x1: x + colW + 4, y1: cursor + cellH / 2, x2: x + colW + hGap - 4, y2: cursor + cellH / 2, color: theme.accent, strokeWidth: theme.strokeWidth - 1, roughness: theme.roughness });
      }
      x += colW + hGap;
    }
    if (row === 0) {
      // Vertical arrow from row 1 to row 2
      const arrowX = left + CONTENT_WIDTH / 2;
      pushArrow(out, { x1: arrowX, y1: cursor + cellH + 4, x2: arrowX, y2: cursor + cellH + vGap - 4, color: theme.accent, strokeWidth: theme.strokeWidth - 1, roughness: theme.roughness });
    }
    cursor += cellH + vGap;
  }
  return cursor - yCursor - vGap;
}

function patternTripletList(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternTripletList,
  theme: ThemeSpec,
): number {
  const items = (p.items ?? []).filter((s) => s && s.length > 0);
  if (items.length === 0) return 0;
  let cursor = yCursor;

  if (p.title) {
    const fsT = theme.fontSub;
    const m = measure(p.title, fsT, CONTENT_WIDTH);
    pushText(out, { x: left, y: cursor, w: m.w, h: m.h, text: m.lines.join("\n"), fs: fsT, color: theme.ink, bold: true });
    const ulY = cursor + m.h - 2;
    pushLine(out, { x1: left, y1: ulY, x2: left + Math.min(m.w + 40, CONTENT_WIDTH - 80), y2: ulY, color: theme.red, strokeWidth: theme.strokeWidth, roughness: theme.roughness });
    cursor += m.h + 28;
  }

  const fs = theme.fontBody;
  const numCol = 56;
  const gap = 22;
  const tw = CONTENT_WIDTH - numCol;

  for (let i = 0; i < items.length; i += 1) {
    const num = `${i + 1}\u3001`;
    pushText(out, { x: left, y: cursor, w: numCol - 10, h: lineH(fs), text: num, fs, color: theme.red, bold: true });
    const m = measure(items[i], fs, tw);
    pushText(out, { x: left + numCol, y: cursor, w: tw, h: m.h, text: m.lines.join("\n"), fs, color: theme.ink, bold: true });
    cursor += m.h + gap;
  }
  return cursor - yCursor - gap;
}

function patternSceneWithQuotes(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternSceneWithQuotes,
  theme: ThemeSpec,
): number {
  const fs = theme.fontBody;
  const scene = measure(p.scene, fs, CONTENT_WIDTH);
  pushText(out, { x: left, y: yCursor, w: CONTENT_WIDTH, h: scene.h, text: scene.lines.join("\n"), fs, color: theme.ink });
  let cursor = yCursor + scene.h + 18;

  for (const rawQ of p.quotes.filter((s) => s && s.trim().length > 1)) {
    const trimmed = rawQ.trim();
    if (!trimmed || /^["""'\u300c\u300e\u300d\u300f]+$/.test(trimmed)) continue;
    const hasQuote = /^["""'\u300c\u300e]/.test(trimmed) && /["""'\u300d\u300f]$/.test(trimmed);
    const quoteText = hasQuote ? trimmed : `\u201c${trimmed}\u201d`;
    const m = measure(quoteText, fs, CONTENT_WIDTH - 80);

    // Left accent bar
    pushRect(out, { x: left + 10, y: cursor, w: 4, h: m.h, stroke: theme.accent, fill: theme.accent, strokeWidth: 0, radius: 2, roughness: 0 });
    pushText(out, { x: left + 28, y: cursor, w: CONTENT_WIDTH - 48, h: m.h, text: m.lines.join("\n"), fs, color: theme.inkSoft });
    cursor += m.h + 10;
  }
  return cursor - yCursor;
}

function patternCaseBox(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternCaseBox,
  theme: ThemeSpec,
): number {
  const fs = theme.fontBody;
  const innerW = CONTENT_WIDTH - 80;
  const padX = 40;
  const padY = 32;

  type Block = { kind: "punch" | "wrong" | "right" | "quote" | "body"; m: ReturnType<typeof measure>; text: string };
  const blocks: Block[] = [];
  if (p.punch) blocks.push({ kind: "punch", text: p.punch, m: measure(p.punch, fs, innerW) });
  if (p.wrong) blocks.push({ kind: "wrong", text: p.wrong, m: measure(p.wrong, fs, innerW - theme.fontSymbol - 18) });
  if (p.right) blocks.push({ kind: "right", text: p.right, m: measure(p.right, fs, innerW - theme.fontSymbol - 18) });
  if (p.quote) blocks.push({ kind: "quote", text: p.quote, m: measure(`\u201c${p.quote.replace(/^["\u201c]|["\u201d]$/g, "")}\u201d`, fs, innerW - 40) });
  if (p.body) blocks.push({ kind: "body", text: p.body, m: measure(p.body, fs, innerW) });

  if (blocks.length === 0) return 0;

  const blockGap = 18;
  const bodyH = blocks.reduce((s, b) => s + b.m.h, 0) + blockGap * (blocks.length - 1);
  const labelH = 40;
  const boxH = bodyH + padY * 2;
  const boxTop = yCursor + labelH / 2;

  // Box background
  pushRect(out, { x: left, y: boxTop, w: CONTENT_WIDTH, h: boxH, stroke: theme.ink, fill: theme.cardFill, strokeWidth: theme.strokeWidth + 1, radius: 18, roughness: theme.roughness });

  // Label chip
  const rawLabel = p.label && p.label.length > 0 ? p.label : "\u4e3e\u4e2a\u4f8b\u5b50";
  const labelText = rawLabel.length > 8 ? rawLabel.slice(0, 7) + "\u2026" : rawLabel;
  const fsLabel = theme.fontMeta;
  const labelW = textWidth(labelText, fsLabel) + 28;
  pushRect(out, { x: left + 22, y: yCursor, w: labelW, h: labelH, stroke: theme.accent, fill: theme.paper, strokeWidth: theme.strokeWidth, radius: 10, roughness: theme.roughness });
  pushCenteredText(out, { boxX: left + 22, boxY: yCursor, boxW: labelW, boxH: labelH, lines: [labelText], fs: fsLabel, color: theme.accent, bold: true });

  // Body blocks
  let cursor = boxTop + padY;
  for (const b of blocks) {
    if (b.kind === "punch") {
      pushText(out, { x: left + padX, y: cursor, w: innerW, h: b.m.h, text: b.m.lines.join("\n"), fs, color: theme.red, bold: true });
    } else if (b.kind === "wrong") {
      pushCross(out, left + padX + theme.fontSymbol / 2, cursor + b.m.h / 2, theme.fontSymbol, theme);
      pushText(out, { x: left + padX + theme.fontSymbol + 18, y: cursor + (b.m.h - glyphH(fs, b.m.lines.length)) / 2, w: innerW - theme.fontSymbol - 18, h: glyphH(fs, b.m.lines.length), text: b.m.lines.join("\n"), fs, color: theme.ink, bold: true });
    } else if (b.kind === "right") {
      pushCheck(out, left + padX + theme.fontSymbol / 2, cursor + b.m.h / 2, theme.fontSymbol, theme);
      pushText(out, { x: left + padX + theme.fontSymbol + 18, y: cursor + (b.m.h - glyphH(fs, b.m.lines.length)) / 2, w: innerW - theme.fontSymbol - 18, h: glyphH(fs, b.m.lines.length), text: b.m.lines.join("\n"), fs, color: theme.ink, bold: true });
    } else if (b.kind === "quote") {
      pushRect(out, { x: left + padX, y: cursor, w: 4, h: b.m.h, stroke: theme.accent, fill: theme.accent, strokeWidth: 0, radius: 2, roughness: 0 });
      pushText(out, { x: left + padX + 20, y: cursor, w: innerW - 20, h: b.m.h, text: b.m.lines.join("\n"), fs, color: theme.inkSoft });
    } else {
      pushText(out, { x: left + padX, y: cursor, w: innerW, h: b.m.h, text: b.m.lines.join("\n"), fs, color: theme.ink });
    }
    cursor += b.m.h + blockGap;
  }
  return boxH + labelH / 2 + 4;
}

function patternHighlight(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternHighlight,
  theme: ThemeSpec,
): number {
  const fs = theme.fontSection - 4;
  const text = (p.text ?? "").trim();
  if (!text) return 0;

  const padX = 32;
  const padY = 24;
  const m = measure(text, fs, CONTENT_WIDTH - padX * 2);
  const boxH = m.h + padY * 2;

  // Background fill
  pushRect(out, { x: left, y: yCursor, w: CONTENT_WIDTH, h: boxH, stroke: "transparent", fill: theme.highlightFill, strokeWidth: 0, radius: 14, roughness: 0 });

  // Left accent bar
  pushRect(out, { x: left, y: yCursor + 8, w: 5, h: boxH - 16, stroke: theme.red, fill: theme.red, strokeWidth: 0, radius: 3, roughness: 0 });

  // Text
  pushText(out, { x: left + padX, y: yCursor + padY, w: CONTENT_WIDTH - padX * 2, h: m.h, text: m.lines.join("\n"), fs, color: theme.ink, bold: true });

  return boxH;
}

function patternSummary(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternSummary,
  theme: ThemeSpec,
): number {
  const fs = theme.fontSub;
  const text = (p.text ?? "").trim();
  if (!text) return 0;

  const padX = 36;
  const padY = 30;
  const m = measure(text, fs, CONTENT_WIDTH - padX * 2);
  const boxH = m.h + padY * 2;

  // Top gradient bar
  const barH = 6;
  pushRect(out, { x: left + padX, y: yCursor, w: CONTENT_WIDTH - padX * 2, h: barH, stroke: "transparent", fill: theme.red, strokeWidth: 0, radius: 3, roughness: 0 });
  pushRect(out, { x: left + padX + 60, y: yCursor, w: CONTENT_WIDTH - padX * 2 - 120, h: barH, stroke: "transparent", fill: theme.accent, strokeWidth: 0, radius: 3, roughness: 0, opacity: 60 });

  const boxTop = yCursor + barH + 8;

  // Box
  pushRect(out, { x: left, y: boxTop, w: CONTENT_WIDTH, h: boxH, stroke: theme.ink, fill: theme.cardFill, strokeWidth: theme.strokeWidth, radius: 16, roughness: theme.roughness });

  // "Remember" prefix
  const prefix = "\u8bb0\u4f4f\uff1a";
  const prefixW = textWidth(prefix, fs);
  pushText(out, { x: left + padX, y: boxTop + padY, w: Math.ceil(prefixW) + 4, h: glyphH(fs, 1), text: prefix, fs, color: theme.red, bold: true });
  pushText(out, { x: left + padX + prefixW, y: boxTop + padY, w: CONTENT_WIDTH - padX * 2 - prefixW, h: m.h, text: m.lines.join("\n"), fs, color: theme.ink, bold: true });

  return barH + 8 + boxH;
}

// ============================================================
// Pattern dispatcher
// ============================================================

function renderPattern(
  out: Skel[],
  left: number,
  yCursor: number,
  p: SectionPattern,
  theme: ThemeSpec,
): number {
  switch (p.pattern) {
    case "free_paragraph": return patternFreeParagraph(out, left, yCursor, p, theme);
    case "central_negation": return patternCentralNegation(out, left, yCursor, p, theme);
    case "triplet_circles": return patternTripletCircles(out, left, yCursor, p, theme);
    case "contrast_card": return patternContrastCard(out, left, yCursor, p, theme);
    case "formula_chain": return patternFormulaChain(out, left, yCursor, p, theme);
    case "triplet_list": return patternTripletList(out, left, yCursor, p, theme);
    case "scene_with_quotes": return patternSceneWithQuotes(out, left, yCursor, p, theme);
    case "case_box": return patternCaseBox(out, left, yCursor, p, theme);
    case "highlight": return patternHighlight(out, left, yCursor, p, theme);
    case "summary": return patternSummary(out, left, yCursor, p, theme);
  }
}

// ============================================================
// Public API
// ============================================================

export function renderSectionV2(
  section: PosterSection,
  themeId: PosterTheme,
  origin: Origin,
  yCursor: number,
): { elements: Skel[]; nextY: number } {
  const theme = POSTER_THEMES[themeId];
  const left = origin.x + POSTER_PADDING;
  const out: Skel[] = [];

  const headerH = renderSectionHeader(out, left, yCursor, section, theme);
  let cursor = yCursor + headerH;

  const sectionLabel = (section.label ?? "").trim();
  const cleanedBody = section.body.map((p) => {
    if (p.pattern === "triplet_list" && p.title && sectionLabel && (p.title === sectionLabel || sectionLabel.includes(p.title) || p.title.includes(sectionLabel))) {
      return { ...p, title: "" };
    }
    return p;
  });

  for (let i = 0; i < cleanedBody.length; i += 1) {
    const p = cleanedBody[i];
    const consumed = renderPattern(out, left, cursor, p, theme);
    const nextP = cleanedBody[i + 1];
    const gap = computePatternGap(theme, p, nextP);
    cursor += consumed + (i < cleanedBody.length - 1 ? gap : 0);
  }

  return { elements: out, nextY: cursor + theme.sectionGap };
}

export function renderTitleV2(
  title: string,
  themeId: PosterTheme,
  origin: Origin,
  yCursor: number,
): { elements: Skel[]; nextY: number } {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  const left = origin.x + POSTER_PADDING;
  const fs = theme.fontTitle;
  const m = measure(title, fs, CONTENT_WIDTH);
  const maxLineW = Math.max(...m.lines.map((l) => textWidth(l, fs)));
  const textX = left + (CONTENT_WIDTH - maxLineW) / 2;

  pushText(out, { x: textX, y: yCursor, w: Math.ceil(maxLineW) + 12, h: m.h, text: m.lines.join("\n"), fs, color: theme.ink, bold: true, align: "left" });

  // Double underline with accent color
  const ulW = Math.min(CONTENT_WIDTH * 0.5, 540);
  const ulX = left + (CONTENT_WIDTH - ulW) / 2;
  const ulY = yCursor + m.h + 14;
  pushLine(out, { x1: ulX, y1: ulY, x2: ulX + ulW, y2: ulY, color: theme.ink, strokeWidth: theme.strokeWidth + 1, roughness: theme.roughness });
  pushLine(out, { x1: ulX + 30, y1: ulY + 10, x2: ulX + ulW - 30, y2: ulY + 10, color: theme.red, strokeWidth: theme.strokeWidth, roughness: theme.roughness });

  return { elements: out, nextY: ulY + 24 + theme.heroGap * 0.3 };
}

export function renderOverviewV2(
  items: string[],
  themeId: PosterTheme,
  origin: Origin,
  yCursor: number,
): { elements: Skel[]; nextY: number } {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  const left = origin.x + POSTER_PADDING;
  const consumed = patternTripletCircles(out, left, yCursor, { pattern: "triplet_circles", items }, theme);
  return { elements: out, nextY: yCursor + consumed + 40 };
}

/** Full render of a V2 document (non-streaming fallback) */
export function renderPosterV2(
  doc: PosterDocumentV2,
  themeId: PosterTheme,
  origin: Origin,
): Skel[] {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  let cursor = origin.y + POSTER_PADDING;

  if (doc.title) {
    const r = renderTitleV2(doc.title, themeId, origin, cursor);
    out.push(...r.elements);
    cursor = r.nextY;
  }
  if (doc.overview && doc.overview.length > 0) {
    const r = renderOverviewV2(doc.overview, themeId, origin, cursor);
    out.push(...r.elements);
    cursor = r.nextY;
  }

  for (let i = 0; i < doc.sections.length; i += 1) {
    // Breathing decorator every 3 sections
    if (i > 0 && i % 3 === 0) {
      const left = origin.x + POSTER_PADDING;
      const breathH = pushBreathingDecor(out, left, cursor, CONTENT_WIDTH, theme);
      cursor += breathH + 20;
    }

    const gap = computeSectionGap(theme, i, doc.sections.length, doc.sections[i - 1], doc.sections[i]);
    if (i > 0) cursor += gap - theme.sectionGap; // adjust since renderSectionV2 already adds sectionGap

    const r = renderSectionV2(doc.sections[i], themeId, origin, cursor);
    out.push(...r.elements);
    cursor = r.nextY;
  }

  void POSTER_WIDTH;
  return out;
}
