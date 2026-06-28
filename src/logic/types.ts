export type LogicExportMode = "lecture" | "mindmap";

export type EdgeRelation =
  | "sequential"
  | "chain"
  | "cause"
  | "example_follow"
  | "conclude_from"
  | "fork"
  | "loop"
  | "equiv"
  | "transition";

export type ArrowKind = "straight" | "down" | "curve" | "fan" | "fork";

export type ChainKind =
  | "sequential"
  | "hub"
  | "fan_neg"
  | "fork"
  | "step_list"
  | "step_block"
  | "lecture_flow"
  | "mindmap_chain";

export type SentenceRole =
  | "title"
  | "subtitle"
  | "section"
  | "step"
  | "question"
  | "define"
  | "contrast_wrong"
  | "contrast_right"
  | "fork_label"
  | "summary"
  | "body";

export type EmphasisKind =
  | "red_text"
  | "underline"
  | "frame"
  | "circle"
  | "mark_x"
  | "mark_check"
  | "size_up";

export type LogicSentence = {
  id: string;
  start: number;
  end: number;
  role?: SentenceRole;
  paragraphStart?: boolean;
  displayStart?: number;
  displayEnd?: number;
};

export type LogicEdge = {
  from: string;
  to: string;
  relation: EdgeRelation;
  deny?: boolean;
  arrowKind?: ArrowKind;
};

export type LogicEmphasis = {
  start: number;
  end: number;
  kind: EmphasisKind;
  sentenceId?: string;
};

export type LogicChain = {
  id: string;
  kind: ChainKind;
  sentenceIds: string[];
  edges: LogicEdge[];
  groupDeny?: boolean;
};

export type LogicManuscriptIR = {
  source: string;
  normalized: string;
  export: LogicExportMode;
  title?: { start: number; end: number; sentenceId?: string };
  subtitle?: { start: number; end: number; sentenceId?: string };
  sentences: LogicSentence[];
  chains: LogicChain[];
  edges: LogicEdge[];
  emphasis: LogicEmphasis[];
};

export type LogicLayoutResult = {
  elements: import("@excalidraw/excalidraw/data/transform").ExcalidrawElementSkeleton[];
  phaseBreaks: number[];
  height: number;
};
