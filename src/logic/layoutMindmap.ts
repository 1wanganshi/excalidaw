import type { PosterTheme } from "../types";
import { CONTENT_WIDTH, POSTER_PADDING, POSTER_THEMES } from "../poster/themes";
import { pushArrow, pushCross, pushEllipse, pushLine, pushRect, pushText, type Skel } from "./draw";
import { glyphH, measure, textWidth } from "./measure";
import type { LogicManuscriptIR } from "./types";

const CHAIN_GAP = 80;
const NODE_GAP = 36;
const ARROW_LEN = 48;

type Origin = { x: number; y: number };

function keywordText(ir: LogicManuscriptIR, sentenceId: string): string {
  const s = ir.sentences.find((x) => x.id === sentenceId);
  if (!s || s.displayStart === undefined || s.displayEnd === undefined) return "";
  return ir.normalized.slice(s.displayStart, s.displayEnd);
}

export function layoutMindmap(
  ir: LogicManuscriptIR,
  themeId: PosterTheme,
  origin: Origin,
): { elements: Skel[]; phaseBreaks: number[]; height: number } {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  const phaseBreaks: number[] = [];
  const left = origin.x + POSTER_PADDING;
  let y = origin.y + POSTER_PADDING;

  if (ir.title) {
    const titleText = ir.normalized.slice(ir.title.start, ir.title.end);
    const fs = theme.fontTitle;
    const m = measure(titleText, fs, CONTENT_WIDTH);
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
    const ulW = Math.min(CONTENT_WIDTH, textWidth(titleText, fs) + 24);
    const ulX = left + (CONTENT_WIDTH - ulW) / 2;
    const ulY = y + m.h + 4;
    pushLine(out, { x1: ulX, y1: ulY, x2: ulX + ulW, y2: ulY, color: theme.red });
    y += m.h + CHAIN_GAP;
    phaseBreaks.push(out.length);
  }

  const rendered = new Set<string>();
  const mindmapChains = ir.chains.filter((c) => c.kind === "mindmap_chain");
  const stepChains = ir.chains.filter((c) => c.kind === "step_list");
  const fanChains = ir.chains.filter((c) => c.kind === "fan_neg");

  for (const chain of mindmapChains) {
    let cx = left;
    const rowY = y;
    let rowH = 0;

    for (let i = 0; i < chain.sentenceIds.length; i += 1) {
      const sid = chain.sentenceIds[i];
      rendered.add(sid);
      const kw = keywordText(ir, sid);
      const fs = theme.fontSection;
      const kwW = textWidth(kw, fs) + 32;
      const kwH = glyphH(fs, 1) + 16;

      pushEllipse(out, { x: cx, y: rowY, w: kwW, h: kwH, stroke: theme.ink });
      pushText(out, {
        x: cx + 16,
        y: rowY + 8,
        w: kwW - 32,
        h: kwH - 16,
        text: kw,
        fs,
        color: theme.ink,
        bold: true,
      });

      rowH = Math.max(rowH, kwH);
      const nextSid = chain.sentenceIds[i + 1];
      if (nextSid) {
        const hasEdge = chain.edges.some((e) => e.from === sid && e.to === nextSid);
        if (hasEdge) {
          const ax1 = cx + kwW + 4;
          const ax2 = ax1 + ARROW_LEN;
          const midY = rowY + kwH / 2;
          pushArrow(out, { x1: ax1, y1: midY, x2: ax2, y2: midY, color: theme.ink });
          cx = ax2 + 8;
        } else {
          cx += kwW + NODE_GAP;
        }
      } else {
        cx += kwW;
      }
    }

    y = rowY + rowH + CHAIN_GAP;
    phaseBreaks.push(out.length);
  }

  for (const chain of fanChains) {
    const anchorId = chain.sentenceIds[0];
    const anchorKw = keywordText(ir, anchorId) || ir.normalized.slice(
      ir.sentences.find((s) => s.id === anchorId)!.start,
      ir.sentences.find((s) => s.id === anchorId)!.end,
    ).slice(0, 8);
    const fs = theme.fontSection;
    pushText(out, {
      x: left,
      y,
      w: CONTENT_WIDTH,
      h: glyphH(fs, 1),
      text: anchorKw,
      fs,
      color: theme.ink,
      bold: true,
    });
    rendered.add(anchorId);

    const fanY = y + glyphH(fs, 1) + 20;
    const targets = chain.sentenceIds.slice(1);
    const boxFs = theme.fontBody;
    let maxBoxH = 0;
    const boxes: Array<{ x: number; w: number; h: number; text: string }> = [];

    for (let i = 0; i < targets.length; i += 1) {
      const sid = targets[i];
      rendered.add(sid);
      const s = ir.sentences.find((x) => x.id === sid)!;
      const text = ir.normalized.slice(s.start, s.end).slice(0, 24);
      const m = measure(text, boxFs, 140);
      const bx = left + 80 + i * 160;
      boxes.push({ x: bx, w: 150, h: m.h + 20, text: m.lines.join("\n") });
      maxBoxH = Math.max(maxBoxH, m.h + 20);
    }

    const hubX = left + 20;
    const hubY = fanY + maxBoxH / 2;
    for (const box of boxes) {
      pushRect(out, {
        x: box.x,
        y: fanY,
        w: box.w,
        h: box.h,
        stroke: theme.ink,
        radius: 10,
      });
      pushText(out, {
        x: box.x + 8,
        y: fanY + 10,
        w: box.w - 16,
        h: box.h - 20,
        text: box.text,
        fs: boxFs,
        color: theme.ink,
      });
      pushArrow(out, {
        x1: hubX + 40,
        y1: hubY,
        x2: box.x,
        y2: fanY + box.h / 2,
        color: theme.ink,
      });
    }

    if (chain.groupDeny && boxes.length > 0) {
      const midX = left + 80 + (boxes.length * 160) / 2;
      pushCross(out, midX, fanY + maxBoxH / 2, theme.fontSymbol, theme);
    }

    y = fanY + maxBoxH + CHAIN_GAP;
    phaseBreaks.push(out.length);
  }

  for (const chain of stepChains) {
    const introEdge = ir.edges.find((e) => e.relation === "transition" || e.relation === "fork");
    if (introEdge) rendered.add(introEdge.from);

    for (const sid of chain.sentenceIds) {
      rendered.add(sid);
      const s = ir.sentences.find((x) => x.id === sid)!;
      const text = ir.normalized.slice(s.start, s.end);
      const fs = theme.fontSub;
      const m = measure(text, fs, CONTENT_WIDTH - 40);
      pushText(out, {
        x: left + 40,
        y,
        w: CONTENT_WIDTH - 40,
        h: m.h,
        text: m.lines.join("\n"),
        fs,
        color: theme.ink,
      });
      y += m.h + SENTENCE_GAP;
    }
    y += CHAIN_GAP - SENTENCE_GAP;
    phaseBreaks.push(out.length);
  }

  for (const s of ir.sentences) {
    if (rendered.has(s.id)) continue;
    if (ir.title?.sentenceId === s.id || ir.subtitle?.sentenceId === s.id) continue;

    const text = ir.normalized.slice(s.start, s.end);
    const fs = s.role === "summary" ? theme.fontSection : theme.fontBody;
    const color = s.role === "summary" ? theme.red : theme.ink;
    const m = measure(text, fs, CONTENT_WIDTH);
    pushText(out, {
      x: left,
      y,
      w: CONTENT_WIDTH,
      h: m.h,
      text: m.lines.join("\n"),
      fs,
      color,
      bold: s.role === "summary",
    });
    y += m.h + CHAIN_GAP;
    phaseBreaks.push(out.length);
  }

  const height = Math.max(y - origin.y + POSTER_PADDING, 1200);
  return { elements: out, phaseBreaks, height };
}

const SENTENCE_GAP = 20;
