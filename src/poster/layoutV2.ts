/**
 * V2 layout pipeline.
 *
 * Each "section" is rendered as a self-contained block whose visual is chosen
 * by the section's pattern — not by the same ▸ + ↓ everywhere.
 *
 * Goals (parity with the reference whiteboard frames):
 *   - free flowing text where appropriate (no forced cards/bullets/arrows)
 *   - central negation diagrams (one core word fanning out to several X options)
 *   - triplet circles + plus signs as the top overview
 *   - real arrow flows for formula chains
 *   - contrast cards with ✘ / ✓ rows
 *   - case boxes that nest sub-elements
 *
 * Streaming-friendly: every section can be rendered independently, given
 * (origin, yCursor). Returns the new yCursor.
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

const SECTION_GAP = 90;
const PATTERN_GAP = 36;

// ============================================================
// primitives — copied semantics from layout.ts but kept local so this file
// does not couple to the old monolith renderer.
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
    opacity: 100,
    roundness: (o.radius ?? 0) > 0 ? { type: 3 } : null,
  } as Skel);
}

function pushEllipse(
  out: Skel[],
  o: { x: number; y: number; w: number; h: number; stroke: string; strokeWidth?: number },
) {
  out.push({
    type: "ellipse",
    x: o.x,
    y: o.y,
    width: o.w,
    height: o.h,
    strokeColor: o.stroke,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth ?? 4,
    roughness: 2,
    opacity: 100,
  } as Skel);
}

function pushLine(
  out: Skel[],
  o: { x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth?: number; dashed?: boolean },
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
    roughness: 2,
    opacity: 100,
  } as Skel);
}

function pushArrow(
  out: Skel[],
  o: { x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth?: number },
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
    roughness: 2,
    opacity: 100,
    endArrowhead: "arrow",
    startArrowhead: null,
  } as unknown as Skel);
}

function pushCross(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  pushLine(out, { x1: cx - h, y1: cy - h, x2: cx + h, y2: cy + h, color: theme.red, strokeWidth: theme.strokeWidth + 1 });
  pushLine(out, { x1: cx - h, y1: cy + h, x2: cx + h, y2: cy - h, color: theme.red, strokeWidth: theme.strokeWidth + 1 });
}

function pushCheck(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  pushLine(out, { x1: cx - h, y1: cy + 2, x2: cx - h / 3, y2: cy + h - 4, color: theme.green, strokeWidth: theme.strokeWidth + 1 });
  pushLine(out, { x1: cx - h / 3, y1: cy + h - 4, x2: cx + h, y2: cy - h, color: theme.green, strokeWidth: theme.strokeWidth + 1 });
}

// ============================================================
// text measurement — same heuristic the old file uses, but local so v2 stays
// independent.
// ============================================================

function charWidth(ch: string, fs: number): number {
  const code = ch.charCodeAt(0);
  if (/\s/.test(ch)) return fs * 0.35;
  if (code > 0x7f) return fs * 1.08;
  if (/[A-Z0-9]/.test(ch)) return fs * 0.68;
  if (".,:;!?|/\\()[]{}'\"`~-–—_+=<>".includes(ch)) return fs * 0.46;
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
  // 中文/日文标点不能出现在行首 —— 避免「。」「，」「？」孤悬。
  const noLineStart = "。，、；：！？）」』】〗》〕…—·．,.;:!?)]}";
  // 这些不能出现在行尾（避免开括号被挤到行尾）
  const noLineEnd = "「『（〖《〔【([{";
  const isNoStart = (ch: string) => noLineStart.includes(ch);
  const isNoEnd = (ch: string) => noLineEnd.includes(ch);
  const raw: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para.length) {
      raw.push("");
      continue;
    }
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
          if (curW + pw > safe && cur.length > 0) {
            raw.push(cur);
            cur = part;
            curW = pw;
          } else {
            cur += part;
            curW += pw;
          }
        }
        continue;
      }
      if (curW + cw > safe && cur.length > 0) {
        raw.push(cur.trimEnd());
        cur = chunk.trimStart();
        curW = textWidth(cur, fs);
      } else {
        cur += chunk;
        curW += cw;
      }
    }
    if (cur.length > 0) raw.push(cur.trimEnd());
    else raw.push("");
  }
  // 二次扫描：把"行首"的禁开标点贴回上一行；把"行尾"的禁尾字符挤到下一行。
  const out: string[] = [];
  for (let li = 0; li < raw.length; li += 1) {
    let line = raw[li];
    // 行首禁开：把开头的禁开标点挪到上一行末尾
    while (line.length > 0 && out.length > 0 && isNoStart(line[0])) {
      out[out.length - 1] = out[out.length - 1] + line[0];
      line = line.slice(1);
    }
    // 行尾禁尾：把末尾的禁尾字符挪到下一行开头
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
  for (const l of lines) {
    const w = textWidth(l, fs);
    if (w > maxLine) maxLine = w;
  }
  return { lines, w: Math.min(maxLine, maxW), h };
}

/**
 * 在一个矩形盒子 (boxX, boxY, boxW, boxH) 内**真正水平+垂直居中**单/多行文字。
 * Excalidraw 的 `textAlign: "center"` 在 skeleton → element 转换时会把 width
 * 收缩到实际最长行宽度，再在那个收缩后的宽度里居中 —— 视觉上结果是贴在 boxX 那一边。
 * 我们手算 (x, y, w)，textAlign 用 "left"，由我们自己决定位置。
 */
function pushCenteredText(
  out: Skel[],
  o: {
    boxX: number;
    boxY: number;
    boxW: number;
    boxH: number;
    lines: string[];
    fs: number;
    color: string;
    bold?: boolean;
  },
) {
  const maxLineW = Math.max(...o.lines.map((l) => textWidth(l, o.fs)));
  const x = o.boxX + (o.boxW - maxLineW) / 2;
  const gh = glyphH(o.fs, o.lines.length);
  const y = o.boxY + (o.boxH - gh) / 2;
  pushText(out, {
    x,
    y,
    w: Math.ceil(maxLineW) + 8,
    h: gh,
    text: o.lines.join("\n"),
    fs: o.fs,
    color: o.color,
    bold: o.bold,
    align: "left",
  });
}

// ============================================================
// section-level render helpers
// ============================================================

function renderSectionHeader(
  out: Skel[],
  left: number,
  yCursor: number,
  s: PosterSection,
  theme: ThemeSpec,
): number {
  if (!s.label) return 0;
  // 手稿风：「一、章节名：」整段为一个汉字+冒号短语，单行同字号同颜色。
  // 仅在「章节名」那几个字下加一根细红波浪线 —— 不再用大红 01 徽章 + 双下划线。
  const cnNums = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const numPrefix = s.no ? `${cnNums[s.no - 1] ?? s.no}、` : "";
  const colon = "：";
  const label = s.label;
  const fs = theme.fontSection;
  // 前缀 (numPrefix) + 章节名 (label) + 冒号
  const numW = numPrefix ? textWidth(numPrefix, fs) : 0;
  const labelW = textWidth(label, fs);
  const colonW = textWidth(colon, fs);
  const totalW = numW + labelW + colonW;

  if (totalW > CONTENT_WIDTH) {
    // 太长就允许换行：整体 left 对齐
    const fullText = `${numPrefix}${label}${colon}`;
    const m = measure(fullText, fs, CONTENT_WIDTH);
    pushText(out, {
      x: left,
      y: yCursor,
      w: CONTENT_WIDTH,
      h: m.h,
      text: m.lines.join("\n"),
      fs,
      color: theme.ink,
      bold: true,
    });
    return m.h + 6;
  }

  // 三段拼接：前缀、章节名、冒号 —— 用一个 text 元素就够了
  pushText(out, {
    x: left,
    y: yCursor,
    w: Math.ceil(totalW) + 8,
    h: glyphH(fs, 1),
    text: `${numPrefix}${label}${colon}`,
    fs,
    color: theme.ink,
    bold: true,
  });

  // 只在章节名底下画一根细红下划线（手画感）
  const ulX = left + numW;
  const ulY = yCursor + Math.round(fs * 1.18);
  pushLine(out, {
    x1: ulX,
    y1: ulY,
    x2: ulX + labelW,
    y2: ulY,
    color: theme.red,
    strokeWidth: theme.strokeWidth - 1,
  });
  return Math.round(fs * 1.32) + 6;
}

// ----- pattern renderers (each returns consumed pixels) -----

function splitSentences(text: string): string[] {
  const segs: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if ("。！？!?；;".includes(ch)) {
      segs.push(buf);
      buf = "";
    }
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

  // 红字短段（≤ 30 字）直接画一行。
  if (p.emphasis === "red" || compact.length <= 60) {
    const m = measure(text, fs, CONTENT_WIDTH);
    pushText(out, {
      x: left,
      y: yCursor,
      w: CONTENT_WIDTH,
      h: m.h,
      text: m.lines.join("\n"),
      fs,
      color,
      bold: p.emphasis === "red",
    });
    return m.h;
  }

  // 长段 → 按中文句末标点拆，每句独立一行+小留白，让阅读节奏出来。
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    const m = measure(text, fs, CONTENT_WIDTH);
    pushText(out, {
      x: left,
      y: yCursor,
      w: CONTENT_WIDTH,
      h: m.h,
      text: m.lines.join("\n"),
      fs,
      color,
      bold: false,
    });
    return m.h;
  }
  const sentenceGap = 14;
  let cursor = yCursor;
  for (const s of sentences) {
    const m = measure(s, fs, CONTENT_WIDTH);
    pushText(out, {
      x: left,
      y: cursor,
      w: CONTENT_WIDTH,
      h: m.h,
      text: m.lines.join("\n"),
      fs,
      color,
      bold: false,
    });
    cursor += m.h + sentenceGap;
  }
  return cursor - yCursor - sentenceGap;
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
  const optW = (s: string) => textWidth(s, fsOpt) + optPadX * 2;
  const coreW = textWidth(p.center, fsCore) + 12;
  // 高度 = 选项数 * (optH + 间距)
  const optGap = 24;
  const blockH = p.options.length * optH + (p.options.length - 1) * optGap;
  const coreY = yCursor + blockH / 2 - glyphH(fsCore, 1) / 2;
  // 核心词
  pushText(out, {
    x: left + 10,
    y: coreY,
    w: coreW,
    h: glyphH(fsCore, 1),
    text: p.center,
    fs: fsCore,
    color: theme.ink,
    bold: true,
  });
  // 4 个错误答案（带圆角框）
  const fanFromX = left + 10 + coreW + 16;
  const optStartX = left + CONTENT_WIDTH - 320;
  for (let i = 0; i < p.options.length; i += 1) {
    const w = optW(p.options[i]);
    const y = yCursor + i * (optH + optGap);
    pushRect(out, { x: optStartX, y, w, h: optH, stroke: theme.ink, strokeWidth: theme.strokeWidth - 1, radius: 8 });
    pushCenteredText(out, {
      boxX: optStartX,
      boxY: y,
      boxW: w,
      boxH: optH,
      lines: [p.options[i]],
      fs: fsOpt,
      color: theme.ink,
      bold: true,
    });
    // 从核心词斜线指向选项左侧
    pushLine(out, {
      x1: fanFromX,
      y1: yCursor + blockH / 2,
      x2: optStartX - 8,
      y2: y + optH / 2,
      color: theme.ink,
      strokeWidth: theme.strokeWidth - 1,
    });
  }
  // 巨大的红 ✘ 盖在扇形中央
  const crossCx = (fanFromX + optStartX) / 2;
  const crossCy = yCursor + blockH / 2;
  const crossSize = Math.min(blockH * 0.7, 130);
  pushCross(out, crossCx, crossCy, crossSize, theme);
  // 加粗一下：在外圈再画一次
  pushCross(out, crossCx + 2, crossCy + 2, crossSize, theme);
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
    pushEllipse(out, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, stroke: theme.ink, strokeWidth: theme.strokeWidth + 1 });
    pushCenteredText(out, {
      boxX: cx - d / 2,
      boxY: cy - d / 2,
      boxW: d,
      boxH: d,
      lines: [items[i]],
      fs,
      color: theme.ink,
      bold: true,
    });
    if (i < items.length - 1) {
      const plusCx = cx + d / 2 + plusW / 2;
      pushCenteredText(out, {
        boxX: plusCx - 16,
        boxY: cy - 22,
        boxW: 32,
        boxH: 44,
        lines: ["+"],
        fs: theme.fontSection,
        color: theme.ink,
        bold: true,
      });
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
  pushRect(out, {
    x: left,
    y: yCursor,
    w: CONTENT_WIDTH,
    h: boxH,
    stroke: theme.ink,
    strokeWidth: theme.strokeWidth + 2,
    radius: 24,
  });
  // wrong 行
  const wrongRowY = yCursor + padY;
  pushCross(out, left + padX + theme.fontSymbol / 2, wrongRowY + wrongH / 2, theme.fontSymbol, theme);
  const wrongTextX = left + padX + theme.fontSymbol + 18;
  pushText(out, {
    x: wrongTextX,
    y: wrongRowY + (wrongH - glyphH(fs, wrongM.lines.length)) / 2,
    w: CONTENT_WIDTH - padX * 2 - theme.fontSymbol - 18,
    h: glyphH(fs, wrongM.lines.length),
    text: wrongM.lines.join("\n"),
    fs,
    color: theme.ink,
    bold: true,
  });
  // divider
  const divY = wrongRowY + wrongH + divider / 2;
  pushLine(out, {
    x1: left + padX,
    y1: divY,
    x2: left + CONTENT_WIDTH - padX,
    y2: divY,
    color: theme.inkSoft,
    strokeWidth: theme.strokeWidth - 1,
    dashed: true,
  });
  // right 行
  const rightRowY = wrongRowY + wrongH + divider;
  pushCheck(out, left + padX + theme.fontSymbol / 2, rightRowY + rightH / 2, theme.fontSymbol, theme);
  pushText(out, {
    x: wrongTextX,
    y: rightRowY + (rightH - glyphH(fs, rightM.lines.length)) / 2,
    w: CONTENT_WIDTH - padX * 2 - theme.fontSymbol - 18,
    h: glyphH(fs, rightM.lines.length),
    text: rightM.lines.join("\n"),
    fs,
    color: theme.ink,
    bold: true,
  });
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
  let x = left + (CONTENT_WIDTH - totalW) / 2;
  if (x < left) x = left;
  const maxH = Math.max(...sizes.map((s) => s.h));
  const cy = yCursor + maxH / 2;
  for (let i = 0; i < items.length; i += 1) {
    const s = sizes[i];
    const y = yCursor + (maxH - s.h) / 2;
    pushRect(out, { x, y, w: s.w, h: s.h, stroke: theme.ink, strokeWidth: theme.strokeWidth, radius: 12 });
    pushCenteredText(out, {
      boxX: x,
      boxY: y,
      boxW: s.w,
      boxH: s.h,
      lines: [items[i]],
      fs,
      color: theme.ink,
      bold: true,
    });
    if (i < items.length - 1) {
      pushArrow(out, {
        x1: x + s.w + 4,
        y1: cy,
        x2: x + s.w + arrowGap - 4,
        y2: cy,
        color: theme.ink,
        strokeWidth: theme.strokeWidth,
      });
    }
    x += s.w + arrowGap;
  }
  return maxH;
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
    pushText(out, {
      x: left,
      y: cursor,
      w: m.w,
      h: m.h,
      text: m.lines.join("\n"),
      fs: fsT,
      color: theme.ink,
      bold: true,
    });
    const ulY = cursor + m.h - 2;
    pushLine(out, {
      x1: left,
      y1: ulY,
      x2: left + Math.min(m.w + 40, CONTENT_WIDTH - 80),
      y2: ulY,
      color: theme.red,
      strokeWidth: theme.strokeWidth,
    });
    pushLine(out, {
      x1: left + 6,
      y1: ulY + 8,
      x2: left + Math.min(m.w + 30, CONTENT_WIDTH - 100),
      y2: ulY + 8,
      color: theme.red,
      strokeWidth: theme.strokeWidth - 1,
    });
    cursor += m.h + 28;
  }
  const fs = theme.fontBody;
  const numCol = 56;
  const gap = 22;
  const tw = CONTENT_WIDTH - numCol;
  for (let i = 0; i < items.length; i += 1) {
    const num = `${i + 1}、`;
    pushText(out, {
      x: left,
      y: cursor,
      w: numCol - 10,
      h: lineH(fs),
      text: num,
      fs,
      color: theme.red,
      bold: true,
    });
    const m = measure(items[i], fs, tw);
    pushText(out, {
      x: left + numCol,
      y: cursor,
      w: tw,
      h: m.h,
      text: m.lines.join("\n"),
      fs,
      color: theme.ink,
      bold: true,
    });
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
  pushText(out, {
    x: left,
    y: yCursor,
    w: CONTENT_WIDTH,
    h: scene.h,
    text: scene.lines.join("\n"),
    fs,
    color: theme.ink,
  });
  let cursor = yCursor + scene.h + 18;
  for (const rawQ of p.quotes.filter((s) => s && s.trim().length > 1)) {
    // 过滤掉只有引号/标点的空条目，避免孤儿引号独占一行
    const trimmed = rawQ.trim();
    if (!trimmed) continue;
    if (/^["""'「『」』]+$/.test(trimmed)) continue;
    const hasQuote = /^["""'「『]/.test(trimmed) && /["""'」』]$/.test(trimmed);
    const quoteText = hasQuote ? trimmed : `"${trimmed}"`;
    const m = measure(quoteText, fs, CONTENT_WIDTH - 80);
    // 左侧灰竖线
    pushLine(out, {
      x1: left + 14,
      y1: cursor,
      x2: left + 14,
      y2: cursor + m.h - 4,
      color: theme.inkSoft,
      strokeWidth: 3,
    });
    pushText(out, {
      x: left + 40,
      y: cursor,
      w: CONTENT_WIDTH - 60,
      h: m.h,
      text: m.lines.join("\n"),
      fs,
      color: theme.inkSoft,
    });
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
  // 收集子块测量
  type Block = { kind: "punch" | "wrong" | "right" | "quote" | "body"; m: ReturnType<typeof measure>; text: string };
  const blocks: Block[] = [];
  if (p.punch) blocks.push({ kind: "punch", text: p.punch, m: measure(p.punch, fs, innerW) });
  if (p.wrong) blocks.push({ kind: "wrong", text: p.wrong, m: measure(p.wrong, fs, innerW - theme.fontSymbol - 18) });
  if (p.right) {
    const t = p.right.includes("\n") ? p.right : p.right;
    blocks.push({ kind: "right", text: t, m: measure(t, fs, innerW - theme.fontSymbol - 18) });
  }
  if (p.quote) blocks.push({ kind: "quote", text: p.quote, m: measure(`"${p.quote.replace(/^[""]|[""]$/g, "")}"`, fs, innerW - 40) });
  if (p.body) blocks.push({ kind: "body", text: p.body, m: measure(p.body, fs, innerW) });

  if (blocks.length === 0) return 0;

  const blockGap = 18;
  const bodyH = blocks.reduce((s, b) => s + b.m.h, 0) + blockGap * (blocks.length - 1);
  const labelH = 40;
  const boxH = bodyH + padY * 2;
  const boxTop = yCursor + labelH / 2;
  pushRect(out, {
    x: left,
    y: boxTop,
    w: CONTENT_WIDTH,
    h: boxH,
    stroke: theme.ink,
    strokeWidth: theme.strokeWidth + 1,
    radius: 18,
  });
  // label chip — 截断超长 label，避免 chip 撑爆框线
  const rawLabel = p.label && p.label.length > 0 ? p.label : "举个例子";
  const labelText = rawLabel.length > 8 ? rawLabel.slice(0, 7) + "…" : rawLabel;
  const fsLabel = theme.fontMeta;
  const labelW = textWidth(labelText, fsLabel) + 28;
  pushRect(out, {
    x: left + 22,
    y: yCursor,
    w: labelW,
    h: labelH,
    stroke: theme.ink,
    fill: theme.paper,
    strokeWidth: theme.strokeWidth,
    radius: 10,
  });
  pushCenteredText(out, {
    boxX: left + 22,
    boxY: yCursor,
    boxW: labelW,
    boxH: labelH,
    lines: [labelText],
    fs: fsLabel,
    color: theme.ink,
    bold: true,
  });
  // body
  let cursor = boxTop + padY;
  for (const b of blocks) {
    if (b.kind === "punch") {
      pushText(out, {
        x: left + padX,
        y: cursor,
        w: innerW,
        h: b.m.h,
        text: b.m.lines.join("\n"),
        fs,
        color: theme.red,
        bold: true,
      });
    } else if (b.kind === "wrong") {
      pushCross(out, left + padX + theme.fontSymbol / 2, cursor + b.m.h / 2, theme.fontSymbol, theme);
      pushText(out, {
        x: left + padX + theme.fontSymbol + 18,
        y: cursor + (b.m.h - glyphH(fs, b.m.lines.length)) / 2,
        w: innerW - theme.fontSymbol - 18,
        h: glyphH(fs, b.m.lines.length),
        text: b.m.lines.join("\n"),
        fs,
        color: theme.ink,
        bold: true,
      });
    } else if (b.kind === "right") {
      pushCheck(out, left + padX + theme.fontSymbol / 2, cursor + b.m.h / 2, theme.fontSymbol, theme);
      pushText(out, {
        x: left + padX + theme.fontSymbol + 18,
        y: cursor + (b.m.h - glyphH(fs, b.m.lines.length)) / 2,
        w: innerW - theme.fontSymbol - 18,
        h: glyphH(fs, b.m.lines.length),
        text: b.m.lines.join("\n"),
        fs,
        color: theme.ink,
        bold: true,
      });
    } else if (b.kind === "quote") {
      pushLine(out, {
        x1: left + padX,
        y1: cursor + 2,
        x2: left + padX,
        y2: cursor + b.m.h - 2,
        color: theme.inkSoft,
        strokeWidth: 3,
      });
      pushText(out, {
        x: left + padX + 20,
        y: cursor,
        w: innerW - 20,
        h: b.m.h,
        text: b.m.lines.join("\n"),
        fs,
        color: theme.inkSoft,
      });
    } else if (b.kind === "body") {
      pushText(out, {
        x: left + padX,
        y: cursor,
        w: innerW,
        h: b.m.h,
        text: b.m.lines.join("\n"),
        fs,
        color: theme.ink,
      });
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
  // 手稿风：左对齐黑字 + 字下方一根细红下划线。
  // 不再画句末小红圈——避免视觉杂讯。
  const fs = theme.fontSection - 4; // 比章节小一点，比正文大
  const text = (p.text ?? "").trim();
  if (!text) return 0;
  const m = measure(text, fs, CONTENT_WIDTH);
  pushText(out, {
    x: left,
    y: yCursor,
    w: CONTENT_WIDTH,
    h: m.h,
    text: m.lines.join("\n"),
    fs,
    color: theme.ink,
    bold: true,
  });
  // 最后一行下方画红色下划线
  const lastLineIdx = m.lines.length - 1;
  const lastLine = m.lines[lastLineIdx] ?? "";
  const lastLineW = textWidth(lastLine, fs);
  const ulY = yCursor + Math.round(fs * 1.2) + lastLineIdx * lineH(fs);
  pushLine(out, {
    x1: left + 4,
    y1: ulY,
    x2: left + lastLineW - 4,
    y2: ulY,
    color: theme.red,
    strokeWidth: theme.strokeWidth - 1,
  });
  return m.h + 8;
}

function patternSummary(
  out: Skel[],
  left: number,
  yCursor: number,
  p: PatternSummary,
  theme: ThemeSpec,
): number {
  // 手稿风总结：「记住：xxx」 — 前缀手写感，结论句下加一根粗红波浪线，不再用 chip + 红框。
  const fs = theme.fontSub;
  const text = (p.text ?? "").trim();
  if (!text) return 0;
  const prefix = "记住：";
  const prefixW = textWidth(prefix, fs);
  const bodyM = measure(text, fs, CONTENT_WIDTH - prefixW);
  // 前缀
  pushText(out, {
    x: left,
    y: yCursor,
    w: Math.ceil(prefixW) + 4,
    h: glyphH(fs, 1),
    text: prefix,
    fs,
    color: theme.red,
    bold: true,
  });
  // 结论
  pushText(out, {
    x: left + prefixW,
    y: yCursor,
    w: CONTENT_WIDTH - prefixW,
    h: bodyM.h,
    text: bodyM.lines.join("\n"),
    fs,
    color: theme.ink,
    bold: true,
  });
  // 整段下面一根粗红波浪线
  const ulY = yCursor + bodyM.h + 4;
  const ulW = Math.min(CONTENT_WIDTH - 40, prefixW + (bodyM.lines[bodyM.lines.length - 1] ? textWidth(bodyM.lines[bodyM.lines.length - 1], fs) : 0) + 40);
  pushLine(out, {
    x1: left,
    y1: ulY,
    x2: left + ulW,
    y2: ulY,
    color: theme.red,
    strokeWidth: theme.strokeWidth,
  });
  pushLine(out, {
    x1: left + 12,
    y1: ulY + 7,
    x2: left + ulW - 16,
    y2: ulY + 7,
    color: theme.red,
    strokeWidth: theme.strokeWidth - 1,
  });
  return bodyM.h + 22;
}

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
// public API
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
  // Drop the inline title of triplet_list when it duplicates the section.label —
  // 否则会看到「05 三步方法」 + 紧跟红下划线小标题「具体步骤」两块叠在一起。
  const sectionLabel = (section.label ?? "").trim();
  const cleanedBody = section.body.map((p) => {
    if (p.pattern === "triplet_list" && p.title && sectionLabel && (p.title === sectionLabel || sectionLabel.includes(p.title) || p.title.includes(sectionLabel))) {
      return { ...p, title: "" };
    }
    return p;
  });
  for (const p of cleanedBody) {
    const consumed = renderPattern(out, left, cursor, p, theme);
    cursor += consumed + PATTERN_GAP;
  }
  cursor -= PATTERN_GAP; // 收回最后一段的 gap
  return { elements: out, nextY: cursor + SECTION_GAP };
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
  // 手动居中：Excalidraw 的 textAlign:center 在多行 + 缩宽时会贴左侧；
  // 我们改为根据最长行宽度算 x，让红下划线和标题真正同轴。
  const maxLineW = Math.max(...m.lines.map((l) => textWidth(l, fs)));
  const textX = left + (CONTENT_WIDTH - maxLineW) / 2;
  pushText(out, {
    x: textX,
    y: yCursor,
    w: Math.ceil(maxLineW) + 12,
    h: m.h,
    text: m.lines.join("\n"),
    fs,
    color: theme.ink,
    bold: true,
    align: "left",
  });
  const ulW = Math.min(CONTENT_WIDTH * 0.5, 540);
  const ulX = left + (CONTENT_WIDTH - ulW) / 2;
  const ulY = yCursor + m.h + 14;
  pushLine(out, { x1: ulX, y1: ulY, x2: ulX + ulW, y2: ulY, color: theme.ink, strokeWidth: theme.strokeWidth + 1 });
  pushLine(out, { x1: ulX + 30, y1: ulY + 10, x2: ulX + ulW - 30, y2: ulY + 10, color: theme.red, strokeWidth: theme.strokeWidth });
  return { elements: out, nextY: ulY + 24 + 40 };
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

/** 完整渲染 V2 文档：一次性把所有元素生成出来（流式时不会用，专为兜底/重渲染保留） */
export function renderPosterV2(
  doc: PosterDocumentV2,
  themeId: PosterTheme,
  origin: Origin,
): Skel[] {
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
  for (const s of doc.sections) {
    const r = renderSectionV2(s, themeId, origin, cursor);
    out.push(...r.elements);
    cursor = r.nextY;
  }
  void POSTER_WIDTH;
  return out;
}
