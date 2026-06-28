import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ThemeSpec } from "../poster/themes";

export type Skel = ExcalidrawElementSkeleton;

export function pushText(
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
    verticalAlign: "top",
    strokeColor: o.color,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: o.bold ? 2 : 1,
    roughness: 0,
    opacity: 100,
  } as Skel);
}

export function pushRect(
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
    roughness: 2,
    opacity: 100,
    roundness: (o.radius ?? 0) > 0 ? { type: 3 } : null,
  } as Skel);
}

export function pushEllipse(out: Skel[], o: { x: number; y: number; w: number; h: number; stroke: string }) {
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
    strokeWidth: 4,
    roughness: 2,
    opacity: 100,
  } as Skel);
}

export function pushLine(
  out: Skel[],
  o: { x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth?: number },
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
    strokeStyle: "solid",
    strokeWidth: o.strokeWidth ?? 3,
    roughness: 2,
    opacity: 100,
  } as Skel);
}

export function pushArrow(
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

export function pushCross(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  pushLine(out, {
    x1: cx - h,
    y1: cy - h,
    x2: cx + h,
    y2: cy + h,
    color: theme.red,
    strokeWidth: theme.strokeWidth + 1,
  });
  pushLine(out, {
    x1: cx - h,
    y1: cy + h,
    x2: cx + h,
    y2: cy - h,
    color: theme.red,
    strokeWidth: theme.strokeWidth + 1,
  });
}

export function pushCheck(out: Skel[], cx: number, cy: number, size: number, theme: ThemeSpec) {
  const h = size / 2;
  pushLine(out, {
    x1: cx - h,
    y1: cy + 2,
    x2: cx - h / 3,
    y2: cy + h - 4,
    color: theme.green,
    strokeWidth: theme.strokeWidth + 1,
  });
  pushLine(out, {
    x1: cx - h / 3,
    y1: cy + h - 4,
    x2: cx + h,
    y2: cy - h,
    color: theme.green,
    strokeWidth: theme.strokeWidth + 1,
  });
}
