import type { PosterTheme } from "../types";
import { buildLogicManuscriptIR } from "./buildIr";
import type { LogicExportMode, LogicLayoutResult, LogicManuscriptIR } from "./types";
import type { PosterDocumentV2 } from "../types";
import { layoutLectureV2, layoutPosterDoc } from "./layoutLectureV2";
import { layoutMindmap } from "./layoutMindmap";
import { irToPosterV2 } from "./irToPosterV2";

type Origin = { x: number; y: number };

export function renderLogicManuscript(
  ir: LogicManuscriptIR,
  themeId: PosterTheme,
  origin: Origin,
  posterDoc?: PosterDocumentV2,
): LogicLayoutResult {
  if (ir.export === "mindmap") {
    return layoutMindmap(ir, themeId, origin);
  }
  if (posterDoc) {
    return layoutPosterDoc(posterDoc, themeId, origin);
  }
  return layoutLectureV2(ir, themeId, origin);
}

export function buildAndRenderLogic(
  source: string,
  exportMode: LogicExportMode,
  themeId: PosterTheme,
  origin: Origin,
  posterDoc?: PosterDocumentV2,
): { ir: LogicManuscriptIR; layout: LogicLayoutResult; posterDoc: PosterDocumentV2 } {
  const ir = buildLogicManuscriptIR(source, exportMode);
  const doc = posterDoc ?? (exportMode === "lecture" ? irToPosterV2(ir) : irToPosterV2(ir));
  const layout = renderLogicManuscript(ir, themeId, origin, exportMode === "lecture" ? posterDoc : undefined);
  return { ir, layout, posterDoc: doc };
}
