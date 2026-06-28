import type { PosterTheme } from "../types";

export const POSTER_WIDTH = 1080;
export const POSTER_PADDING = 90;
export const CONTENT_WIDTH = POSTER_WIDTH - POSTER_PADDING * 2;

export type ExcalidrawFontFamily = 1 | 2 | 3;

export type ThemeSpec = {
  id: PosterTheme;
  label: string;
  description: string;
  paper: string;
  ink: string;
  inkSoft: string;
  red: string;
  green: string;
  highlight: string;
  fontFamily: ExcalidrawFontFamily;
  monoFontFamily: ExcalidrawFontFamily;
  roughness: 0 | 1 | 2;
  strokeWidth: number;
  /** font sizes per "level" */
  fontTitle: number;
  fontSection: number;
  fontSub: number;
  fontBody: number;
  fontMeta: number;
  fontSymbol: number;
};

export const POSTER_THEMES: Record<PosterTheme, ThemeSpec> = {
  whiteboard: {
    id: "whiteboard",
    label: "白板讲解",
    description: "白底黑字红重点，手绘讲义风",
    paper: "#ffffff",
    ink: "#111111",
    inkSoft: "#333333",
    red: "#B22222",
    green: "#2E7D32",
    highlight: "#ffe97a",
    fontFamily: 1,
    monoFontFamily: 1,
    roughness: 2,
    strokeWidth: 3,
    fontTitle: 62,
    fontSection: 46,
    fontSub: 38,
    fontBody: 32,
    fontMeta: 28,
    fontSymbol: 56,
  },
};

export const POSTER_THEME_ORDER: PosterTheme[] = ["whiteboard"];
