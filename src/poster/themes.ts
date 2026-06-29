import type { PosterTheme } from "../types";

export const POSTER_WIDTH = 1080;
export const POSTER_PADDING = 90;
export const CONTENT_WIDTH = POSTER_WIDTH - POSTER_PADDING * 2;

export type ExcalidrawFontFamily = 1 | 2 | 3;

export type SectionBadgeStyle = "circle" | "square" | "pill" | "none";
export type BreathingDecor = "line" | "dots" | "wave" | "none";

export type ThemeSpec = {
  id: PosterTheme;
  label: string;
  description: string;
  paper: string;
  ink: string;
  inkSoft: string;
  red: string;
  green: string;
  accent: string;
  highlight: string;
  cardFill: string;
  highlightFill: string;
  wrongFill: string;
  rightFill: string;
  fontFamily: ExcalidrawFontFamily;
  monoFontFamily: ExcalidrawFontFamily;
  roughness: 0 | 1 | 2;
  strokeWidth: number;
  fontTitle: number;
  fontSection: number;
  fontSub: number;
  fontBody: number;
  fontMeta: number;
  fontSymbol: number;
  sectionBadge: SectionBadgeStyle;
  sectionStripe: boolean;
  breathingDecor: BreathingDecor;
  heroGap: number;
  sectionGap: number;
  patternGap: number;
  dropCap: boolean;
};

export const POSTER_THEMES: Record<PosterTheme, ThemeSpec> = {
  whiteboard: {
    id: "whiteboard",
    label: "白板讲解",
    description: "手绘讲义风，红色重点标注",
    paper: "#ffffff",
    ink: "#1a1a1a",
    inkSoft: "#555555",
    red: "#C62828",
    green: "#2E7D32",
    accent: "#D84315",
    highlight: "#FFF9C4",
    cardFill: "#FAFAFA",
    highlightFill: "#FFF8E1",
    wrongFill: "#FFEBEE",
    rightFill: "#E8F5E9",
    fontFamily: 1,
    monoFontFamily: 1,
    roughness: 2,
    strokeWidth: 3,
    fontTitle: 66,
    fontSection: 46,
    fontSub: 38,
    fontBody: 32,
    fontMeta: 26,
    fontSymbol: 56,
    sectionBadge: "circle",
    sectionStripe: true,
    breathingDecor: "dots",
    heroGap: 140,
    sectionGap: 100,
    patternGap: 40,
    dropCap: false,
  },

  magazine: {
    id: "magazine",
    label: "杂志排版",
    description: "精致色块装饰，强对比层次",
    paper: "#FFFDF7",
    ink: "#1B2A4A",
    inkSoft: "#546E8A",
    red: "#B7410E",
    green: "#1B5E20",
    accent: "#C6922A",
    highlight: "#FEF3C7",
    cardFill: "#F0F4F8",
    highlightFill: "#FDF6E3",
    wrongFill: "#FDE8E8",
    rightFill: "#D1FAE5",
    fontFamily: 1,
    monoFontFamily: 1,
    roughness: 0,
    strokeWidth: 2,
    fontTitle: 76,
    fontSection: 44,
    fontSub: 36,
    fontBody: 30,
    fontMeta: 24,
    fontSymbol: 52,
    sectionBadge: "square",
    sectionStripe: true,
    breathingDecor: "line",
    heroGap: 160,
    sectionGap: 120,
    patternGap: 44,
    dropCap: true,
  },

  blackboard: {
    id: "blackboard",
    label: "黑板报",
    description: "深色底板，粉笔手写质感",
    paper: "#1C2826",
    ink: "#F5F0E8",
    inkSoft: "#A8BDB5",
    red: "#FF6B6B",
    green: "#69DB7C",
    accent: "#74C0FC",
    highlight: "#FCC419",
    cardFill: "#253532",
    highlightFill: "#2C3E3A",
    wrongFill: "#3D2020",
    rightFill: "#1A3D1A",
    fontFamily: 1,
    monoFontFamily: 1,
    roughness: 2,
    strokeWidth: 3,
    fontTitle: 68,
    fontSection: 48,
    fontSub: 40,
    fontBody: 34,
    fontMeta: 28,
    fontSymbol: 58,
    sectionBadge: "circle",
    sectionStripe: false,
    breathingDecor: "wave",
    heroGap: 130,
    sectionGap: 100,
    patternGap: 42,
    dropCap: false,
  },

  minimal: {
    id: "minimal",
    label: "极简现代",
    description: "大量留白，精确线条，冷静克制",
    paper: "#FFFFFF",
    ink: "#1F2937",
    inkSoft: "#9CA3AF",
    red: "#3B82F6",
    green: "#10B981",
    accent: "#6366F1",
    highlight: "#EFF6FF",
    cardFill: "#F9FAFB",
    highlightFill: "#F0F9FF",
    wrongFill: "#FEF2F2",
    rightFill: "#ECFDF5",
    fontFamily: 1,
    monoFontFamily: 1,
    roughness: 0,
    strokeWidth: 2,
    fontTitle: 80,
    fontSection: 42,
    fontSub: 34,
    fontBody: 28,
    fontMeta: 22,
    fontSymbol: 48,
    sectionBadge: "none",
    sectionStripe: false,
    breathingDecor: "line",
    heroGap: 180,
    sectionGap: 140,
    patternGap: 52,
    dropCap: true,
  },
};

export const POSTER_THEME_ORDER: PosterTheme[] = ["whiteboard", "magazine", "blackboard", "minimal"];
