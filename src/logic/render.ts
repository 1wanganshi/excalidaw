import type { PosterTheme } from "../types";
import { buildLogicManuscriptIR } from "./buildIr";
import type { LogicExportMode, LogicLayoutResult, LogicManuscriptIR } from "./types";
import { layoutLectureV2 } from "./layoutLectureV2";
import { layoutMindmap } from "./layoutMindmap";

type Origin = { x: number; y: number };

export function renderLogicManuscript(
  ir: LogicManuscriptIR,
  themeId: PosterTheme,
  origin: Origin,
): LogicLayoutResult {
  if (ir.export === "mindmap") {
    return layoutMindmap(ir, themeId, origin);
  }
  return layoutLectureV2(ir, themeId, origin);
}

export function buildAndRenderLogic(
  source: string,
  exportMode: LogicExportMode,
  themeId: PosterTheme,
  origin: Origin,
): { ir: LogicManuscriptIR; layout: LogicLayoutResult } {
  const ir = buildLogicManuscriptIR(source, exportMode);
  const layout = renderLogicManuscript(ir, themeId, origin);
  return { ir, layout };
}
