import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ModuleCase,
  ModuleContrast,
  ModuleFormula,
  ModuleHighlight,
  ModuleList,
  ModuleOverview,
  ModuleParagraph,
  ModuleSection,
  ModuleSummary,
  ModuleTitle,
  ParagraphRelation,
  PosterDocument,
  PosterModule,
  PosterTheme,
  SemanticMetadata,
} from "../types";
import {
  CONTENT_WIDTH,
  POSTER_PADDING,
  POSTER_THEMES,
  POSTER_WIDTH,
  type ThemeSpec,
} from "./themes";

type Origin = { x: number; y: number };
type Skel = ExcalidrawElementSkeleton;

export type PosterLayout = {
  elements: Skel[];
  /** Indices into `elements` where a new "module" starts (used for streaming pacing). */
  phaseBreaks: number[];
};

const INNER_PADDING = 38;

// ============================================================
// primitive emitters
// ============================================================

function emitText(
  out: Skel[],
  o: {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    fontSize: number;
    fontFamily: 1 | 2 | 3;
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
    width: o.width,
    height: o.height,
    text: o.text,
    fontSize: o.fontSize,
    fontFamily: o.fontFamily,
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

function emitLine(
  out: Skel[],
  o: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    strokeWidth: number;
    roughness?: 0 | 1 | 2;
    dashed?: boolean;
  },
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
    strokeWidth: o.strokeWidth,
    roughness: o.roughness ?? 2,
    opacity: 100,
  } as Skel);
}

function emitArrow(
  out: Skel[],
  o: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    strokeWidth: number;
    roughness?: 0 | 1 | 2;
    curve?: number;
  },
) {
  const dx = o.x2 - o.x1;
  const dy = o.y2 - o.y1;
  const curve = o.curve ?? 0;
  const points: Array<[number, number]> = curve
    ? [[0, 0], [dx / 2 + curve, dy / 2], [dx, dy]]
    : [[0, 0], [dx, dy]];
  out.push({
    type: "arrow",
    x: o.x1,
    y: o.y1,
    width: dx,
    height: dy,
    points,
    strokeColor: o.color,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth,
    roughness: o.roughness ?? 2,
    opacity: 100,
    endArrowhead: "arrow",
    startArrowhead: null,
  } as unknown as Skel);
}

function emitRect(
  out: Skel[],
  o: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
    roughness?: 0 | 1 | 2;
    radius?: number;
  },
) {
  out.push({
    type: "rectangle",
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    strokeColor: o.stroke,
    backgroundColor: o.fill,
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth,
    roughness: o.roughness ?? 2,
    opacity: 100,
    roundness: (o.radius ?? 0) > 0 ? { type: 3 } : null,
  } as Skel);
}

function emitEllipse(
  out: Skel[],
  o: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
    roughness?: 0 | 1 | 2;
  },
) {
  out.push({
    type: "ellipse",
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    strokeColor: o.stroke,
    backgroundColor: o.fill,
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth,
    roughness: o.roughness ?? 2,
    opacity: 100,
  } as Skel);
}

// ============================================================
// text helpers
// ============================================================

function approxCharWidth(ch: string, fontSize: number): number {
  const code = ch.charCodeAt(0);
  if (/\s/.test(ch)) return fontSize * 0.35;
  if (code > 0x7f) return fontSize * 1.08;
  if (/[A-Z0-9]/.test(ch)) return fontSize * 0.68;
  if (".,:;!?|/\\()[]{}'\"`~-–—_+=<>".includes(ch)) return fontSize * 0.46;
  return fontSize * 0.62;
}

function approxTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += approxCharWidth(ch, fontSize);
  return w;
}

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  if (!text) return [""];
  const safeMaxWidth = Math.max(fontSize * 2, maxWidth * 0.92);
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  for (const paragraph of paragraphs) {
    if (!paragraph.length) {
      lines.push("");
      continue;
    }
    let current = "";
    let currentWidth = 0;
    let i = 0;
    while (i < paragraph.length) {
      const ch = paragraph[i];
      const code = ch.charCodeAt(0);
      let chunk = ch;
      let chunkWidth: number;
      if (code <= 0x7f && ch !== " ") {
        let j = i;
        while (j < paragraph.length) {
          const nc = paragraph[j];
          if (nc.charCodeAt(0) > 0x7f || nc === " ") break;
          j += 1;
        }
        chunk = paragraph.slice(i, j);
        chunkWidth = approxTextWidth(chunk, fontSize);
        i = j;
      } else {
        chunkWidth = approxCharWidth(ch, fontSize);
        i += 1;
      }

      if (chunkWidth > safeMaxWidth) {
        for (const part of chunk) {
          const partWidth = approxCharWidth(part, fontSize);
          if (currentWidth + partWidth > safeMaxWidth && current.length > 0) {
            lines.push(current);
            current = part;
            currentWidth = partWidth;
          } else {
            current += part;
            currentWidth += partWidth;
          }
        }
        continue;
      }

      if (currentWidth + chunkWidth > safeMaxWidth && current.length > 0) {
        lines.push(current.trimEnd());
        current = chunk.trimStart();
        currentWidth = approxTextWidth(current, fontSize);
      } else {
        current += chunk;
        currentWidth += chunkWidth;
      }
    }
    if (current.length > 0) lines.push(current.trimEnd());
    else lines.push("");
  }
  if (lines.length === 0) lines.push("");
  return lines;
}

function lineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.68);
}

/**
 * Excalidraw 自身渲染中文字符时实际占用的纵向高度（≈ fontSize × 1.25），
 * 用来计算"视觉居中"的 y 偏移 —— 跟 measureText 里 `textHeight = lineHeight × lines`
 * 不是一回事；后者偏大，用来计算盒子高度。
 */
function glyphHeight(fontSize: number, lines: number): number {
  return Math.round(fontSize * 1.25 * Math.max(1, lines));
}

function measureText(text: string, fontSize: number, maxWidth: number) {
  const wrapped = wrapText(text, fontSize, maxWidth);
  const lh = lineHeight(fontSize);
  let textWidth = 0;
  for (const line of wrapped) {
    const lw = approxTextWidth(line, fontSize);
    if (lw > textWidth) textWidth = lw;
  }
  textWidth = Math.min(textWidth, maxWidth);
  return { wrapped, textWidth, textHeight: lh * wrapped.length };
}

function emitWrapped(
  out: Skel[],
  x: number,
  y: number,
  wrapped: string[],
  fontSize: number,
  fontFamily: 1 | 2 | 3,
  color: string,
  width: number,
  align: "left" | "center" | "right" = "left",
  bold = false,
) {
  emitText(out, {
    x,
    y,
    width,
    height: lineHeight(fontSize) * wrapped.length,
    text: wrapped.join("\n"),
    fontSize,
    fontFamily,
    color,
    align,
    bold,
  });
}

// ============================================================
// hand-drawn motifs
// ============================================================

/** Hand-drawn red wavy underline below given baseline (multiple lines stacked). */
function emitRedUnderlineWavy(
  out: Skel[],
  x: number,
  y: number,
  w: number,
  theme: ThemeSpec,
) {
  emitLine(out, {
    x1: x,
    y1: y,
    x2: x + w,
    y2: y,
    color: theme.red,
    strokeWidth: theme.strokeWidth,
    roughness: 2,
  });
  emitLine(out, {
    x1: x + 6,
    y1: y + 7,
    x2: x + w - 12,
    y2: y + 7,
    color: theme.red,
    strokeWidth: theme.strokeWidth - 1,
    roughness: 2,
  });
}

const KEYWORD_MARKERS = [
  "重点",
  "关键",
  "核心",
  "误区",
  "错误",
  "不要",
  "不是",
  "而是",
  "记住",
  "公式",
  "方法",
  "方案",
  "问题",
  "痛点",
  "结果",
  "好处",
  "案例",
  "为什么",
  "怎么做",
];

function emitKeywordUnderlines(
  out: Skel[],
  x: number,
  y: number,
  wrapped: string[],
  fontSize: number,
  theme: ThemeSpec,
  maxMarks = 2,
) {
  let marks = 0;
  const lh = lineHeight(fontSize);
  // 边界字符：让关键词必须独立成词，不再把"胜任感"里的"任感"误划
  const boundary = /[，。！？；：、,.!?:;\s　「」""''『』《》()（）\[\]【】]/;
  const isBoundary = (ch: string | undefined) => ch === undefined || boundary.test(ch);
  for (let lineIndex = 0; lineIndex < wrapped.length; lineIndex += 1) {
    const line = wrapped[lineIndex];
    for (const keyword of KEYWORD_MARKERS) {
      const at = line.indexOf(keyword);
      if (at < 0) continue;
      const before = at > 0 ? line[at - 1] : undefined;
      const after = at + keyword.length < line.length ? line[at + keyword.length] : undefined;
      if (!isBoundary(before) || !isBoundary(after)) continue;
      const beforeText = line.slice(0, at);
      const markX = x + approxTextWidth(beforeText, fontSize);
      const markW = Math.min(approxTextWidth(keyword, fontSize), CONTENT_WIDTH - (markX - x));
      emitRedUnderlineWavy(out, markX, y + lineIndex * lh + Math.round(fontSize * 1.28), markW, theme);
      marks += 1;
      break;
    }
    if (marks >= maxMarks) break;
  }
}

function wrapTokens(text: string): string[] {
  return text
    .replace(/([，。！？；：、])/g, "$1\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Big ✘ red cross symbol */
function emitCross(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  emitLine(out, {
    x1: cx - h,
    y1: cy - h,
    x2: cx + h,
    y2: cy + h,
    color: theme.red,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
  });
  emitLine(out, {
    x1: cx - h,
    y1: cy + h,
    x2: cx + h,
    y2: cy - h,
    color: theme.red,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
  });
}

/** Big ✔ green checkmark */
function emitCheck(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  emitLine(out, {
    x1: cx - h,
    y1: cy + 2,
    x2: cx - h / 3,
    y2: cy + h - 4,
    color: theme.green,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
  });
  emitLine(out, {
    x1: cx - h / 3,
    y1: cy + h - 4,
    x2: cx + h,
    y2: cy - h,
    color: theme.green,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
  });
}

/** Hand-drawn down arrow between modules */
function emitDownArrow(out: Skel[], cx: number, y: number, len: number, theme: ThemeSpec) {
  emitArrow(out, {
    x1: cx,
    y1: y,
    x2: cx,
    y2: y + len,
    color: theme.ink,
    strokeWidth: theme.strokeWidth,
    roughness: 2,
  });
}

// ============================================================
// semantic-aware layout helpers
// ============================================================

/** 根据语义关系计算模块间距 */
function computeModuleGap(current: PosterModule, next: PosterModule): number {
  const rel = next.semantic?.relationToPrev;
  // 同一主题下的递进/举例关系 → 紧凑
  if (rel === "elaborates" || rel === "exampleOf") return 36;
  // 对比关系 → 留足视觉空间
  if (rel === "contrasts") return 80;
  // 因果/顺序 → 标准稍紧
  if (rel === "causes" || rel === "sequential") return 52;
  // section/title 前后留白更大
  if (current.kind === "section" || current.kind === "title") return 80;
  // 总结前留白
  if (next.kind === "summary") return 80;
  // 默认间距
  return 64;
}

/** 根据重要性调整主题 */
function effectiveThemeForImportance(base: ThemeSpec, semantic?: SemanticMetadata): ThemeSpec {
  if (!semantic) return base;
  if (semantic.importance === 3) {
    return {
      ...base,
      fontBody: Math.min(base.fontBody + 4, 44),
      fontSub: Math.min(base.fontSub + 4, 48),
      strokeWidth: base.strokeWidth + 1,
    };
  }
  if (semantic.importance === 1) {
    return {
      ...base,
      fontBody: Math.max(base.fontBody - 4, 22),
      fontSub: Math.max(base.fontSub - 4, 26),
      strokeWidth: Math.max(base.strokeWidth - 1, 1),
      ink: base.inkSoft,
    };
  }
  return base;
}

/** 在两模块间绘制语义关系连接器 */
function emitSemanticConnector(
  out: Skel[],
  cx: number,
  yStart: number,
  gap: number,
  relation: ParagraphRelation | undefined,
  theme: ThemeSpec,
) {
  if (!relation || relation === "none") {
    // 无特定关系：微小装饰点
    emitLine(out, {
      x1: cx, y1: yStart + 4,
      x2: cx, y2: yStart + gap - 4,
      color: theme.inkSoft,
      strokeWidth: 1,
      roughness: 2,
      dashed: true,
    });
    return;
  }

  const midY = yStart + gap / 2;
  const arrLen = gap - 16;

  switch (relation) {
    case "causes": {
      // 实线箭头 + "导致" 标签
      emitArrow(out, {
        x1: cx, y1: yStart + 8,
        x2: cx, y2: yStart + arrLen,
        color: theme.ink,
        strokeWidth: theme.strokeWidth,
        roughness: 2,
      });
      emitText(out, {
        x: cx - 28, y: midY - 12,
        width: 56, height: 24,
        text: "导致", fontSize: 18,
        fontFamily: 1, color: theme.ink,
        bold: true, align: "center",
      });
      break;
    }
    case "contrasts": {
      // 双向箭头 + "vs" 标签
      const clr = theme.red;
      emitArrow(out, {
        x1: cx, y1: yStart + 8,
        x2: cx, y2: yStart + arrLen,
        color: clr, strokeWidth: theme.strokeWidth,
        roughness: 2,
      });
      emitArrow(out, {
        x1: cx, y1: yStart + arrLen,
        x2: cx, y2: yStart + 8,
        color: clr, strokeWidth: theme.strokeWidth - 1,
        roughness: 2,
      });
      emitText(out, {
        x: cx - 16, y: midY - 12,
        width: 32, height: 24,
        text: "vs", fontSize: 18,
        fontFamily: 1, color: clr,
        bold: true, align: "center",
      });
      break;
    }
    case "elaborates": {
      // 箭头 + "+" 标签
      emitArrow(out, {
        x1: cx, y1: yStart + 8,
        x2: cx, y2: yStart + arrLen,
        color: theme.ink,
        strokeWidth: theme.strokeWidth,
        roughness: 2,
      });
      emitText(out, {
        x: cx - 10, y: midY - 12,
        width: 20, height: 24,
        text: "+", fontSize: 22,
        fontFamily: 1, color: theme.ink,
        bold: true, align: "center",
      });
      break;
    }
    case "exampleOf": {
      // 箭头 + "例如" 标签
      emitArrow(out, {
        x1: cx, y1: yStart + 8,
        x2: cx, y2: yStart + arrLen,
        color: theme.ink,
        strokeWidth: theme.strokeWidth,
        roughness: 2,
      });
      emitText(out, {
        x: cx - 28, y: midY - 12,
        width: 56, height: 24,
        text: "例如", fontSize: 18,
        fontFamily: 1, color: theme.ink,
        bold: true, align: "center",
      });
      break;
    }
    case "sequential": {
      // 简洁箭头
      emitArrow(out, {
        x1: cx, y1: yStart + 8,
        x2: cx, y2: yStart + arrLen,
        color: theme.ink,
        strokeWidth: theme.strokeWidth,
        roughness: 2,
      });
      break;
    }
  }
}

// ============================================================
// per-module renderers (each returns the consumed height + pushes elements)
// ============================================================

function renderTitle(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleTitle,
  theme: ThemeSpec,
): number {
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  const fs = theme.fontTitle;
  const { wrapped, textHeight } = measureText(m.text, fs, width);
  emitWrapped(out, left, yCursor, wrapped, fs, theme.fontFamily, theme.ink, width, "center", true);
  // double hand-drawn underline below title, centered
  const ulW = Math.min(width * 0.55, 540);
  const ulX = left + (width - ulW) / 2;
  const ulY = yCursor + textHeight + 14;
  emitLine(out, {
    x1: ulX,
    y1: ulY,
    x2: ulX + ulW,
    y2: ulY,
    color: theme.ink,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
  });
  emitLine(out, {
    x1: ulX + 30,
    y1: ulY + 10,
    x2: ulX + ulW - 30,
    y2: ulY + 10,
    color: theme.red,
    strokeWidth: theme.strokeWidth,
    roughness: 2,
  });
  return textHeight + 30;
}

function renderSection(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleSection,
  theme: ThemeSpec,
): number {
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  const fs = theme.fontSection;
  const { wrapped, textWidth, textHeight } = measureText(m.text, fs, width);
  emitWrapped(out, left, yCursor, wrapped, fs, theme.fontFamily, theme.ink, width, "left", true);
  // red underline beneath section
  emitRedUnderlineWavy(out, left, yCursor + textHeight + 6, Math.min(textWidth + 40, width), theme);
  return textHeight + 22;
}

function renderOverview(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleOverview,
  theme: ThemeSpec,
): number {
  const items = (m.items ?? []).filter((s) => s && s.length > 0);
  if (items.length === 0) return 0;

  const left = origin.x + POSTER_PADDING;
  const fs = theme.fontSub;

  // 选择形态：
  //   - 短词（每项 ≤ 4 个汉字）且 ≤ 3 项 → 大圆 + "+" 组合（参考图的『问题 + 解法 + 方案』）
  //   - 其他 → 横向胶囊条 + 箭头串联，避免大圆把页面顶满又显得幼稚
  const maxCharLen = items.reduce((a, s) => Math.max(a, s.length), 0);
  const useCircles = items.length <= 3 && maxCharLen <= 4;

  if (useCircles) {
    return renderOverviewCircles(out, left, yCursor, items, fs, theme);
  }
  return renderOverviewPills(out, left, yCursor, items, theme);
}

function renderOverviewCircles(
  out: Skel[],
  left: number,
  yCursor: number,
  items: string[],
  fs: number,
  theme: ThemeSpec,
): number {
  let maxLabel = 0;
  for (const it of items) {
    const w = approxTextWidth(it, fs);
    if (w > maxLabel) maxLabel = w;
  }
  const circleD = Math.min(Math.max(150, maxLabel + 56), 200);
  const plusW = 64;
  const totalW = items.length * circleD + (items.length - 1) * plusW;
  const startX = Math.max(left, left + (CONTENT_WIDTH - totalW) / 2);
  const cy = yCursor + circleD / 2;

  for (let i = 0; i < items.length; i += 1) {
    const cx = startX + i * (circleD + plusW) + circleD / 2;
    emitEllipse(out, {
      x: cx - circleD / 2,
      y: cy - circleD / 2,
      width: circleD,
      height: circleD,
      fill: "transparent",
      stroke: theme.ink,
      strokeWidth: theme.strokeWidth + 1,
      roughness: 2,
    });
    // 圆内文字：手动居中 —— 由我们算出 y，让字落到圆心
    const gh = glyphHeight(fs, 1);
    emitText(out, {
      x: cx - (circleD - 24) / 2,
      y: cy - gh / 2,
      width: circleD - 24,
      height: gh,
      text: items[i],
      fontSize: fs,
      fontFamily: theme.fontFamily,
      color: theme.ink,
      bold: true,
      align: "center",
    });
    if (i < items.length - 1) {
      const plusX = cx + circleD / 2 + plusW / 2 - 16;
      const plusGh = glyphHeight(theme.fontSection, 1);
      emitText(out, {
        x: plusX,
        y: cy - plusGh / 2,
        width: 32,
        height: plusGh,
        text: "+",
        fontSize: theme.fontSection,
        fontFamily: theme.fontFamily,
        color: theme.ink,
        bold: true,
        align: "center",
      });
    }
  }
  return circleD + 8;
}

function renderOverviewPills(
  out: Skel[],
  left: number,
  yCursor: number,
  items: string[],
  theme: ThemeSpec,
): number {
  const fs = theme.fontSub;
  const padX = 24;
  const padY = 14;
  const arrowGap = 36;
  type Pill = { w: number; h: number; text: string };
  const pills: Pill[] = items.map((t) => {
    const tw = approxTextWidth(t, fs);
    return { w: Math.min(tw + padX * 2, 280), h: lineHeight(fs) + padY * 2, text: t };
  });
  const totalW = pills.reduce((s, p) => s + p.w, 0) + arrowGap * (pills.length - 1);

  // 单行能放下 → 横向胶囊 + 实线箭头
  if (totalW <= CONTENT_WIDTH) {
    let x = left + (CONTENT_WIDTH - totalW) / 2;
    const h = Math.max(...pills.map((p) => p.h));
    const cy = yCursor + h / 2;
    for (let i = 0; i < pills.length; i += 1) {
      const p = pills[i];
      const py = yCursor + (h - p.h) / 2;
      emitRect(out, {
        x,
        y: py,
        width: p.w,
        height: p.h,
        fill: "transparent",
        stroke: theme.ink,
        strokeWidth: theme.strokeWidth,
        roughness: 2,
        radius: Math.round(p.h / 2),
      });
      const gh = glyphHeight(fs, 1);
      emitText(out, {
        x: x + 12,
        y: py + (p.h - gh) / 2,
        width: p.w - 24,
        height: gh,
        text: p.text,
        fontSize: fs,
        fontFamily: theme.fontFamily,
        color: theme.ink,
        bold: true,
        align: "center",
      });
      if (i < pills.length - 1) {
        emitArrow(out, {
          x1: x + p.w + 4,
          y1: cy,
          x2: x + p.w + arrowGap - 4,
          y2: cy,
          color: theme.ink,
          strokeWidth: theme.strokeWidth,
          roughness: 2,
        });
      }
      x += p.w + arrowGap;
    }
    return h + 8;
  }

  // 太长 → 竖排胶囊 + 向下箭头，保持紧凑
  let cursor = yCursor;
  const cx = left + CONTENT_WIDTH / 2;
  for (let i = 0; i < pills.length; i += 1) {
    const p = pills[i];
    emitRect(out, {
      x: cx - p.w / 2,
      y: cursor,
      width: p.w,
      height: p.h,
      fill: "transparent",
      stroke: theme.ink,
      strokeWidth: theme.strokeWidth,
      roughness: 2,
      radius: Math.round(p.h / 2),
    });
    const gh = glyphHeight(fs, 1);
    emitText(out, {
      x: cx - p.w / 2 + 12,
      y: cursor + (p.h - gh) / 2,
      width: p.w - 24,
      height: gh,
      text: p.text,
      fontSize: fs,
      fontFamily: theme.fontFamily,
      color: theme.ink,
      bold: true,
      align: "center",
    });
    cursor += p.h;
    if (i < pills.length - 1) {
      emitDownArrow(out, cx, cursor + 4, 30, theme);
      cursor += 40;
    }
  }
  return cursor - yCursor;
}

function renderParagraph(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleParagraph,
  theme: ThemeSpec,
): number {
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  const fs = theme.fontBody;
  const text = m.text ?? "";
  const compact = text.replace(/\s+/g, "");

  // 长段（> 60 字）自动按句拆分，每句独立一行 + ▸；
  // 整组段落左侧画一根细竖线表示"这是一段"。
  // 这是参考图里中段那种 "图像感" 的关键 —— 不再把 200 字塞进一个框。
  const sentences = splitIntoSentences(text);
  if (compact.length > 60 && sentences.length >= 2) {
    return renderParagraphSentences(out, left, yCursor, width, fs, sentences, theme);
  }

  const isMethodCue = /(不是.+而是|不要.+要|错在哪|为什么|怎么做|三个好处|目标客户|极刚|痛点|方案)/.test(compact);
  const isShortPunch = compact.length <= 36;

  // ▸ 段首符号 + 左侧色条：参考图里中段经常用这种"批注"感强的样式
  const showBullet = isMethodCue || isShortPunch;
  const showRule = isShortPunch;

  const bulletW = showBullet ? 34 : 0;
  const ruleW = showRule ? 6 : 0;
  const leftIndent = bulletW + ruleW + (showRule ? 12 : 0);
  const useWidth = width - leftIndent;
  const { wrapped, textHeight } = measureText(text, fs, useWidth);

  if (showRule) {
    emitRect(out, {
      x: left,
      y: yCursor - 2,
      width: ruleW,
      height: textHeight + 4,
      fill: theme.red,
      stroke: theme.red,
      strokeWidth: 1,
      roughness: 0,
      radius: 3,
    });
  }
  if (showBullet) {
    emitText(out, {
      x: left + (showRule ? ruleW + 12 : 0),
      y: yCursor,
      width: bulletW,
      height: lineHeight(fs),
      text: "▸",
      fontSize: fs,
      fontFamily: theme.fontFamily,
      color: theme.red,
      bold: true,
      valign: "top",
    });
  }
  emitWrapped(
    out,
    left + leftIndent,
    yCursor,
    wrapped,
    fs,
    theme.fontFamily,
    theme.ink,
    useWidth,
    "left",
    isMethodCue || isShortPunch,
  );
  emitKeywordUnderlines(
    out,
    left + leftIndent,
    yCursor,
    wrapped,
    fs,
    theme,
    isMethodCue ? 3 : 2,
  );
  return textHeight + 12;
}

function splitIntoSentences(text: string): string[] {
  // 把段落按中文句末标点切开，但保留每句末尾的标点本身，方便后续 source 校验
  const segments: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (/[。！？!?；;]/.test(ch)) {
      segments.push(buf);
      buf = "";
    }
  }
  if (buf.trim().length > 0) segments.push(buf);
  return segments
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function renderParagraphSentences(
  out: Skel[],
  left: number,
  yCursor: number,
  width: number,
  fs: number,
  sentences: string[],
  theme: ThemeSpec,
): number {
  const rulePadX = 22;
  const bulletW = 28;
  const leftIndent = rulePadX + bulletW;
  const useWidth = width - leftIndent;
  const sentenceGap = 12;

  // 测量每条
  const measured = sentences.map((s) => measureText(s, fs, useWidth));
  const totalH = measured.reduce((sum, m) => sum + m.textHeight + sentenceGap, 0) - sentenceGap;

  // 整体左侧的细竖线
  emitLine(out, {
    x1: left + 4,
    y1: yCursor + 4,
    x2: left + 4,
    y2: yCursor + totalH - 4,
    color: theme.inkSoft,
    strokeWidth: 2,
    roughness: 1,
  });

  let cursor = yCursor;
  for (let i = 0; i < sentences.length; i += 1) {
    const m = measured[i];
    emitText(out, {
      x: left + rulePadX,
      y: cursor,
      width: bulletW,
      height: lineHeight(fs),
      text: "▸",
      fontSize: fs,
      fontFamily: theme.fontFamily,
      color: theme.red,
      bold: true,
    });
    emitWrapped(
      out,
      left + leftIndent,
      cursor,
      m.wrapped,
      fs,
      theme.fontFamily,
      theme.ink,
      useWidth,
      "left",
    );
    emitKeywordUnderlines(out, left + leftIndent, cursor, m.wrapped, fs, theme, 1);
    cursor += m.textHeight + sentenceGap;
  }
  return totalH + 8;
}

function renderHighlight(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleHighlight,
  theme: ThemeSpec,
): number {
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  const fs = theme.fontSub;
  const padX = 38;
  const padY = 30;
  const innerW = width - padX * 2;
  const { wrapped, textHeight } = measureText(m.text, fs, innerW);
  const boxH = textHeight + padY * 2;
  emitRect(out, {
    x: left,
    y: yCursor,
    width,
    height: boxH,
    fill: "transparent",
    stroke: theme.red,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
    radius: 18,
  });
  // 用手动居中：以 glyphHeight 估算真实文字高度，把 y 偏移到盒中。
  const lines = wrapped.length;
  const gh = glyphHeight(fs, lines);
  emitText(out, {
    x: left + padX,
    y: yCursor + (boxH - gh) / 2,
    width: innerW,
    height: gh,
    text: wrapped.join("\n"),
    fontSize: fs,
    fontFamily: theme.fontFamily,
    color: theme.red,
    bold: true,
    align: "center",
  });
  // 红色双划线点缀（参考图里的着重感）
  emitLine(out, {
    x1: left + padX,
    y1: yCursor + boxH - 14,
    x2: left + width - padX,
    y2: yCursor + boxH - 14,
    color: theme.red,
    strokeWidth: theme.strokeWidth - 1,
    roughness: 2,
  });
  return boxH;
}

function renderContrast(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleContrast,
  theme: ThemeSpec,
): number {
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  const fs = theme.fontBody;
  const symbolSize = theme.fontSymbol;
  const symbolCol = 80;
  const padX = 38;
  const padY = 30;
  const textX = left + padX + symbolCol + 24;
  const textW = width - padX * 2 - symbolCol - 24;

  const wrongStr = m.wrong ?? "";
  const rightStr = m.right ?? "";
  const wrongM = measureText(wrongStr, fs, textW);
  const rightM = measureText(rightStr, fs, textW);

  const lineGap = 42;
  const innerH = wrongM.textHeight + lineGap + rightM.textHeight;
  const boxH = innerH + padY * 2;

  // outer box
  emitRect(out, {
    x: left,
    y: yCursor,
    width,
    height: boxH,
    fill: "transparent",
    stroke: theme.ink,
    strokeWidth: theme.strokeWidth + 2,
    roughness: 2,
    radius: 24,
  });

  // ✘ row
  let yRow = yCursor + padY;
  if (wrongStr) {
    emitCross(out, left + padX + symbolSize / 2, yRow + Math.min(wrongM.textHeight, lineHeight(fs)) / 2 - 2, symbolSize, theme);
    emitWrapped(out, textX, yRow, wrongM.wrapped, fs, theme.fontFamily, theme.ink, textW, "left", true);
    emitKeywordUnderlines(out, textX, yRow, wrongM.wrapped, fs, theme, 1);
    yRow += wrongM.textHeight + lineGap;
  }
  // divider
  emitLine(out, {
    x1: left + padX,
    y1: yRow - lineGap / 2,
    x2: left + width - padX,
    y2: yRow - lineGap / 2,
    color: theme.inkSoft,
    strokeWidth: theme.strokeWidth - 1,
    roughness: 2,
    dashed: true,
  });
  // ✔ row
  if (rightStr) {
    emitCheck(out, left + padX + symbolSize / 2, yRow + Math.min(rightM.textHeight, lineHeight(fs)) / 2 - 2, symbolSize, theme);
    emitWrapped(out, textX, yRow, rightM.wrapped, fs, theme.fontFamily, theme.ink, textW, "left", true);
    emitKeywordUnderlines(out, textX, yRow, rightM.wrapped, fs, theme, 2);
  }

  return boxH;
}

function renderFormula(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleFormula,
  theme: ThemeSpec,
): number {
  const rawItems = (m.items ?? []).filter((s) => s && s.length > 0);
  if (rawItems.length === 0) return 0;
  const splitItems = rawItems.length === 1 ? wrapTokens(rawItems[0]) : rawItems;
  const items = splitItems.length > 0 ? splitItems : rawItems;
  const left = origin.x + POSTER_PADDING;
  const fs = theme.fontSub;
  const padX = 30;
  const padY = 20;
  const arrowGap = 44;

  // Per-item box width = its text width + padding
  type Item = { text: string; w: number; h: number; wrapped: string[] };
  const measured: Item[] = items.map((t) => {
    const { wrapped, textWidth, textHeight } = measureText(t, fs, 320);
    return { text: t, w: Math.min(Math.max(textWidth + padX * 2, 140), CONTENT_WIDTH * 0.9), h: textHeight + padY * 2, wrapped };
  });

  const totalW = measured.reduce((s, it) => s + it.w, 0) + arrowGap * (measured.length - 1);
  const boxH = Math.max(...measured.map((it) => it.h));

  // Try one row
  if (totalW <= CONTENT_WIDTH) {
    let startX = left + (CONTENT_WIDTH - totalW) / 2;
    const cy = yCursor + boxH / 2;
    for (let i = 0; i < measured.length; i += 1) {
      const it = measured[i];
      const bx = startX;
      const by = yCursor + (boxH - it.h) / 2;
      emitRect(out, {
        x: bx,
        y: by,
        width: it.w,
        height: it.h,
        fill: "transparent",
        stroke: theme.ink,
        strokeWidth: theme.strokeWidth + 1,
        roughness: 2,
        radius: 14,
      });
      // 手动居中：让公式短语在 chip 里视觉上正好居中。
      const lines = it.wrapped.length;
      const gh = glyphHeight(fs, lines);
      emitText(out, {
        x: bx + padX,
        y: by + (it.h - gh) / 2,
        width: it.w - padX * 2,
        height: gh,
        text: it.wrapped.join("\n"),
        fontSize: fs,
        fontFamily: theme.fontFamily,
        color: theme.ink,
        bold: true,
        align: "center",
      });
      if (i < measured.length - 1) {
        emitArrow(out, {
          x1: bx + it.w + 4,
          y1: cy,
          x2: bx + it.w + arrowGap - 4,
          y2: cy,
          color: theme.ink,
          strokeWidth: theme.strokeWidth,
          roughness: 2,
        });
      }
      startX += it.w + arrowGap;
    }
    return boxH;
  }

  // Vertical stack with down arrows
  const cx = left + CONTENT_WIDTH / 2;
  let cursor = yCursor;
  for (let i = 0; i < measured.length; i += 1) {
    const it = measured[i];
    const bx = cx - it.w / 2;
    emitRect(out, {
      x: bx,
      y: cursor,
      width: it.w,
      height: it.h,
      fill: "transparent",
      stroke: theme.ink,
      strokeWidth: theme.strokeWidth + 1,
      roughness: 2,
      radius: 14,
    });
    {
      const lines = it.wrapped.length;
      const gh = glyphHeight(fs, lines);
      emitText(out, {
        x: bx + padX,
        y: cursor + (it.h - gh) / 2,
        width: it.w - padX * 2,
        height: gh,
        text: it.wrapped.join("\n"),
        fontSize: fs,
        fontFamily: theme.fontFamily,
        color: theme.ink,
        bold: true,
        align: "center",
      });
    }
    cursor += it.h;
    if (i < measured.length - 1) {
      emitDownArrow(out, cx, cursor + 4, 40, theme);
      cursor += 56;
    }
  }
  return cursor - yCursor;
}

function renderCase(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleCase,
  theme: ThemeSpec,
): number {
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  const fs = theme.fontBody;
  const labelTextRaw = (m.label && m.label.length > 0 ? m.label : "举个例子");
  const labelText = approxTextWidth(labelTextRaw, theme.fontMeta) > 220 ? "案例" : labelTextRaw;
  const fsLabel = theme.fontMeta;
  const padX = 36;
  const padY = 28;
  const innerW = width - padX * 2;
  const labelW = approxTextWidth(labelText, fsLabel) + 28;
  const labelH = 40;
  const bodyM = measureText(m.text ?? "", fs, innerW);
  const boxH = bodyM.textHeight + padY * 2 + 18;
  const boxTop = yCursor + labelH / 2;

  // Outer rounded box (with the label chip overlapping its top edge)
  emitRect(out, {
    x: left,
    y: boxTop,
    width,
    height: boxH,
    fill: "transparent",
    stroke: theme.ink,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
    radius: 18,
  });
  // Label chip at top-left
  emitRect(out, {
    x: left + 22,
    y: yCursor,
    width: labelW,
    height: labelH,
    fill: theme.paper,
    stroke: theme.ink,
    strokeWidth: theme.strokeWidth,
    roughness: 2,
    radius: 10,
  });
  // Label chip text — 手动居中
  {
    const gh = glyphHeight(fsLabel, 1);
    emitText(out, {
      x: left + 22,
      y: yCursor + (labelH - gh) / 2,
      width: labelW,
      height: gh,
      text: labelText,
      fontSize: fsLabel,
      fontFamily: theme.fontFamily,
      color: theme.ink,
      bold: true,
      align: "center",
    });
  }
  // Body
  emitWrapped(out, left + padX, boxTop + padY, bodyM.wrapped, fs, theme.fontFamily, theme.ink, innerW);
  emitKeywordUnderlines(out, left + padX, boxTop + padY, bodyM.wrapped, fs, theme, 2);
  return boxH + labelH / 2 + 4;
}

function renderList(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleList,
  theme: ThemeSpec,
): number {
  const items = (m.items ?? []).filter((s) => s && s.length > 0);
  if (items.length === 0) return 0;
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  let cursor = yCursor;

  if (m.title) {
    const fsT = theme.fontSub;
    const tM = measureText(m.title, fsT, width);
    emitWrapped(out, left, cursor, tM.wrapped, fsT, theme.fontFamily, theme.ink, width, "left", true);
    emitRedUnderlineWavy(out, left, cursor + tM.textHeight + 4, Math.min(tM.textWidth + 30, width - 80), theme);
    cursor += tM.textHeight + 32;
  }

  const fs = theme.fontBody;
  const numberCol = 58;
  const itemGap = 28;
  const textW = width - numberCol;

  for (let i = 0; i < items.length; i += 1) {
    const num = `${i + 1}、`;
    emitText(out, {
      x: left,
      y: cursor,
      width: numberCol - 10,
      height: lineHeight(fs),
      text: num,
      fontSize: fs,
      fontFamily: theme.fontFamily,
      color: theme.red,
      bold: true,
    });
    const iM = measureText(items[i], fs, textW);
    emitWrapped(out, left + numberCol, cursor, iM.wrapped, fs, theme.fontFamily, theme.ink, textW, "left", true);
    emitKeywordUnderlines(out, left + numberCol, cursor, iM.wrapped, fs, theme, 1);
    cursor += iM.textHeight + itemGap;
  }
  return cursor - yCursor - itemGap;
}

function renderSummary(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: ModuleSummary,
  theme: ThemeSpec,
): number {
  const left = origin.x + POSTER_PADDING;
  const width = CONTENT_WIDTH;
  const fs = theme.fontSub;
  const padX = 38;
  const padY = 34;
  const innerW = width - padX * 2;
  const { wrapped, textHeight } = measureText(m.text ?? "", fs, innerW);
  const boxH = textHeight + padY * 2 + 28;

  // down arrow lead-in
  emitDownArrow(out, left + width / 2, yCursor, 36, theme);
  const boxTop = yCursor + 48;

  emitRect(out, {
    x: left,
    y: boxTop,
    width,
    height: boxH,
    fill: "transparent",
    stroke: theme.red,
    strokeWidth: theme.strokeWidth + 1,
    roughness: 2,
    radius: 22,
  });
  // small "总结" chip
  const labelText = "总结";
  const fsLabel = theme.fontMeta;
  const labelW = approxTextWidth(labelText, fsLabel) + 28;
  emitRect(out, {
    x: left + 22,
    y: boxTop - 20,
    width: labelW,
    height: 40,
    fill: theme.paper,
    stroke: theme.red,
    strokeWidth: theme.strokeWidth,
    roughness: 2,
    radius: 10,
  });
  {
    const gh = glyphHeight(fsLabel, 1);
    emitText(out, {
      x: left + 22,
      y: boxTop - 20 + (40 - gh) / 2,
      width: labelW,
      height: gh,
      text: labelText,
      fontSize: fsLabel,
      fontFamily: theme.fontFamily,
      color: theme.red,
      bold: true,
      align: "center",
    });
  }
  emitWrapped(out, left + padX, boxTop + padY, wrapped, fs, theme.fontFamily, theme.ink, innerW, "left", true);
  return 48 + boxH;
}

// ============================================================
// dispatcher
// ============================================================

function renderModule(
  out: Skel[],
  origin: Origin,
  yCursor: number,
  m: PosterModule,
  theme: ThemeSpec,
): number {
  // 基于语义重要性调整视觉权重
  const t = effectiveThemeForImportance(theme, m.semantic);
  switch (m.kind) {
    case "title":
      return renderTitle(out, origin, yCursor, m, t);
    case "section":
      return renderSection(out, origin, yCursor, m, t);
    case "overview":
      return renderOverview(out, origin, yCursor, m, t);
    case "paragraph":
      return renderParagraph(out, origin, yCursor, m, t);
    case "highlight":
      return renderHighlight(out, origin, yCursor, m, t);
    case "contrast":
      return renderContrast(out, origin, yCursor, m, t);
    case "formula":
      return renderFormula(out, origin, yCursor, m, t);
    case "case":
      return renderCase(out, origin, yCursor, m, t);
    case "list":
      return renderList(out, origin, yCursor, m, t);
    case "summary":
      return renderSummary(out, origin, yCursor, m, t);
  }
}

void INNER_PADDING;

/**
 * Render a single module at (origin, yCursor) and return:
 *  - elements: Excalidraw skeletons produced for this module
 *  - consumed: vertical pixels the module occupied (without the gap)
 *  - nextY:    the next y-cursor including the recommended inter-module gap
 * This is used by the streaming code path to draw modules as soon as the LLM
 * emits them, without needing to know the rest of the document.
 */
export function renderSingleModule(
  module: PosterModule,
  themeId: PosterTheme,
  origin: Origin,
  yCursor: number,
): { elements: Skel[]; consumed: number; nextY: number } {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  const consumed = renderModule(out, origin, yCursor, module, theme);
  // 流式时还看不到下一个模块，先用一个稳妥的默认间距（与 contrast/summary 的特殊间距相近）。
  const gap = 64;
  return {
    elements: out,
    consumed,
    nextY: yCursor + consumed + gap,
  };
}

export function renderPoster(
  doc: PosterDocument,
  themeId: PosterTheme,
  origin: Origin,
): PosterLayout {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  const phaseBreaks: number[] = [];
  const modules = (doc.modules ?? []).filter(Boolean);

  // First: paper background placeholder — we'll patch its height once we know total height.
  const bgIndex = out.length;
  out.push({
    type: "rectangle",
    x: origin.x,
    y: origin.y,
    width: POSTER_WIDTH,
    height: 100, // patched
    strokeColor: "#cccccc",
    backgroundColor: theme.paper,
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    opacity: 100,
    roundness: { type: 3 },
  } as Skel);
  phaseBreaks.push(out.length);

  let yCursor = origin.y + POSTER_PADDING;

  for (let i = 0; i < modules.length; i += 1) {
    const m = modules[i];
    const before = out.length;
    const consumed = renderModule(out, origin, yCursor, m, theme);
    if (out.length === before) continue;
    yCursor += consumed;

    // 在模块间插入语义连接器（非最后一个模块）
    const nextModule = modules[i + 1];
    if (nextModule) {
      const gap = computeModuleGap(m, nextModule);
      const cx = origin.x + POSTER_PADDING + CONTENT_WIDTH / 2;
      emitSemanticConnector(out, cx, yCursor, gap, nextModule.semantic?.relationToPrev, theme);
      yCursor += gap;
    }

    phaseBreaks.push(out.length);
  }

  // Trailing padding
  yCursor += POSTER_PADDING;
  const totalHeight = Math.max(yCursor - origin.y, 1920);

  // Patch background height
  // @ts-expect-error skeleton allows mutating
  out[bgIndex].height = totalHeight;

  return { elements: out, phaseBreaks };
}

// ============================================================
// Streaming incremental renderer
// ============================================================

/** 流式渲染状态：逐个添加模块，自动追踪位置 */
export class PosterStreamer {
  private yCursor: number;
  private origin: Origin;
  private theme: ThemeSpec;
  private lastModule: PosterModule | null = null;
  private _elements: Skel[] = [];
  private _phaseBreaks: number[] = [];

  constructor(themeId: PosterTheme, origin: Origin) {
    this.theme = POSTER_THEMES[themeId];
    this.origin = origin;
    this.yCursor = origin.y + POSTER_PADDING;
  }

  /** 当前已累积的 skeleton 元素 */
  get elements(): readonly Skel[] {
    return this._elements;
  }

  /** 当前已累积的 phase 断点 */
  get phaseBreaks(): readonly number[] {
    return this._phaseBreaks;
  }

  /** 当前总高度（含已渲染模块 + 间距） */
  get totalHeight(): number {
    return Math.max(this.yCursor - this.origin.y + POSTER_PADDING, 1920);
  }

  /** 添加一个模块，返回该模块新产生的 skeleton 元素 */
  addModule(m: PosterModule): Skel[] {
    const t = effectiveThemeForImportance(this.theme, m.semantic);
    const out: Skel[] = [];

    // 非首个模块：先插入连接器 + 间距
    if (this.lastModule) {
      const gap = computeModuleGap(this.lastModule, m);
      if (m.semantic?.relationToPrev && m.semantic.relationToPrev !== "none") {
        const cx = this.origin.x + POSTER_PADDING + CONTENT_WIDTH / 2;
        emitSemanticConnector(out, cx, this.yCursor, gap, m.semantic.relationToPrev, this.theme);
      }
      this.yCursor += gap;
    }

    // 渲染当前模块
    const consumed = renderModule(out, this.origin, this.yCursor, m, t);
    this.yCursor += consumed;
    this._elements.push(...out);
    this._phaseBreaks.push(this._elements.length);
    this.lastModule = m;

    return out;
  }

  /** 重置流式渲染器（用于重新开始） */
  reset(origin: Origin) {
    this.origin = origin;
    this.yCursor = origin.y + POSTER_PADDING;
    this.lastModule = null;
    this._elements = [];
    this._phaseBreaks = [];
  }
}
