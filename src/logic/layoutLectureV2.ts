import type { PosterDocumentV2, PosterTheme } from "../types";
import { CONTENT_WIDTH, POSTER_PADDING, POSTER_THEMES, POSTER_WIDTH } from "../poster/themes";
import {
  renderOverviewV2,
  renderSectionV2,
  renderTitleV2,
} from "../poster/layoutV2";
import type { LogicManuscriptIR } from "./types";
import { irToPosterV2 } from "./irToPosterV2";
import type { Skel } from "./draw";

type Origin = { x: number; y: number };

/** 从 PosterDocumentV2 渲染讲义长图（本地或 AI 布局计划均可） */
export function layoutPosterDoc(
  doc: PosterDocumentV2,
  themeId: PosterTheme,
  origin: Origin,
): { elements: Skel[]; phaseBreaks: number[]; height: number } {
  const theme = POSTER_THEMES[themeId];
  const out: Skel[] = [];
  const phaseBreaks: number[] = [];
  let cursor = origin.y + POSTER_PADDING;

  const bgIndex = out.length;
  out.push({
    type: "rectangle",
    x: origin.x,
    y: origin.y,
    width: POSTER_WIDTH,
    height: 100,
    strokeColor: "#e8e8e8",
    backgroundColor: theme.paper,
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    opacity: 100,
    roundness: { type: 3 },
  } as Skel);
  phaseBreaks.push(out.length);

  if (doc.title) {
    const r = renderTitleV2(doc.title, themeId, origin, cursor);
    out.push(...r.elements);
    cursor = r.nextY;
    phaseBreaks.push(out.length);
  }

  if (doc.overview && doc.overview.length >= 2) {
    const r = renderOverviewV2(doc.overview, themeId, origin, cursor);
    out.push(...r.elements);
    cursor = r.nextY;
    phaseBreaks.push(out.length);
  }

  for (const section of doc.sections) {
    const r = renderSectionV2(section, themeId, origin, cursor);
    out.push(...r.elements);
    cursor = r.nextY;
    phaseBreaks.push(out.length);
  }

  const totalHeight = Math.max(cursor - origin.y + POSTER_PADDING, 1920);
  // @ts-expect-error skeleton patch
  out[bgIndex].height = totalHeight;

  void CONTENT_WIDTH;
  return { elements: out, phaseBreaks, height: totalHeight };
}

/** 讲义长图：Logic IR → 本地 V2 映射 → 渲染 */
export function layoutLectureV2(
  ir: LogicManuscriptIR,
  themeId: PosterTheme,
  origin: Origin,
): { elements: Skel[]; phaseBreaks: number[]; height: number } {
  return layoutPosterDoc(irToPosterV2(ir), themeId, origin);
}

/** 调试：预览 V2 文档结构 */
export function debugPosterDoc(ir: LogicManuscriptIR) {
  return irToPosterV2(ir);
}
