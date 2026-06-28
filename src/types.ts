import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

export type AiModelKind = "image" | "language";
export type AiModelProvider = "openai-compatible" | "custom";

export type AiModelConfig = {
  id: string;
  kind: AiModelKind;
  name: string;
  provider: AiModelProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageEndpoint: string;
  chatEndpoint: string;
  testEndpoint: string;
};

export type PromptPreset = {
  id: string;
  name: string;
  prompt: string;
};

export type PosterTheme = "whiteboard";

// ============================================================
// Semantic analysis types (for two-phase diagram generation)
// ============================================================

/** 文章内容类型 */
export type ArticleType = "tutorial" | "argument" | "explanation" | "comparison" | "narrative" | "mixed";

/** 段落间语义关系 */
export type ParagraphRelation =
  | "causes"       // 因果：A → B
  | "contrasts"    // 对比：A vs B
  | "elaborates"   // 递进/详细说明：A，进一步地 B
  | "exampleOf"    // 举例：A，例如 B
  | "sequential"   // 顺序/步骤：第一步 → 第二步
  | "none";        // 无特定关系

/** 语义分析结果（第一阶段输出） */
export type SemanticAnalysis = {
  articleType: ArticleType;
  keyConcepts: string[];
  importanceBySegment: number[];     // 1-3，每段一行
  paragraphRelations: Array<{
    fromIndex: number;
    toIndex: number;
    relation: ParagraphRelation;
  }>;
  suggestedVisualFlow: "flow" | "tower" | "split" | "timeline" | "default";
  totalParagraphs: number;
};

/** 挂在每个模块上的语义元信息 */
export type SemanticMetadata = {
  importance: 1 | 2 | 3;           // 该模块在文中的重要性
  relationToPrev?: ParagraphRelation; // 与前一个模块的语义关系
  relatedConcepts?: string[];        // 关联的关键概念
};

// Each module ALWAYS carries the original-source text it covers, in `source`.
// `source` is what gets character-multiset-validated against the original input
// so we guarantee the user's text is never lost. Visual fields (title, etc.)
// are decorative additions that DO NOT participate in validation.

export type ModuleTitle = {
  kind: "title";
  text: string; // article title; if AI generated, allowed (decorative)
  source: ""; // titles do not consume original text
};

export type ModuleSection = {
  kind: "section";
  text: string; // section heading; can be AI-generated label (decorative)
  source: ""; // does not consume original text
};

export type ModuleOverview = {
  kind: "overview";
  /** circle labels in order; visual only */
  items: string[];
  source: ""; // overview labels are decorative, do not consume original text
};

export type ModuleParagraph = {
  kind: "paragraph";
  text: string;
  source: string;
};

export type ModuleHighlight = {
  kind: "highlight";
  text: string;
  source: string;
};

export type ModuleContrast = {
  kind: "contrast";
  /** wrong example raw text */
  wrong: string;
  /** right example raw text */
  right: string;
  /** concatenated wrong+right = source consumed */
  source: string;
};

export type ModuleFormula = {
  kind: "formula";
  /** parts joined with → */
  items: string[];
  source: string;
};

export type ModuleCase = {
  kind: "case";
  /** decorative label like "举个例子" */
  label?: string;
  text: string;
  source: string;
};

export type ModuleList = {
  kind: "list";
  /** decorative label e.g. "三个好处" */
  title?: string;
  items: string[];
  source: string;
};

export type ModuleSummary = {
  kind: "summary";
  text: string;
  source: string;
};

export type PosterModule = (
  | ModuleTitle
  | ModuleSection
  | ModuleOverview
  | ModuleParagraph
  | ModuleHighlight
  | ModuleContrast
  | ModuleFormula
  | ModuleCase
  | ModuleList
  | ModuleSummary
) & {
  /** 语义元信息（由两阶段分析管道填充） */
  semantic?: SemanticMetadata;
};

export type PosterDocument = {
  title: string;
  modules: PosterModule[];
};

// ============================================================
// v2 Section / Pattern model（0.2.8+）
// 把整篇文章重组为 4–7 个 section，每个 section 选一种 pattern。
// 不同 pattern 有不同字段；source 仍负责字符校验。
// ============================================================

export type PatternFreeParagraph = {
  pattern: "free_paragraph";
  text: string;          // 自由段，无边框
  emphasis?: "normal" | "red"; // 整段红字（"不是给标准答案/而是给思考路径"那种）
};

export type PatternCentralNegation = {
  pattern: "central_negation";
  center: string;        // 左侧核心词（≤ 8 字）
  options: string[];     // 右侧扇出 2–6 个错误答案（每个 ≤ 6 字）
};

export type PatternTripletCircles = {
  pattern: "triplet_circles";
  items: string[];       // 2–4 个，每个 ≤ 4 字
};

export type PatternContrastCard = {
  pattern: "contrast_card";
  wrong_label?: string;  // 默认 "你以为"
  wrong: string;
  right_label?: string;  // 默认 "真相"
  right: string;
};

export type PatternFormulaChain = {
  pattern: "formula_chain";
  items: string[];       // 2–4 步，每步 ≤ 6 字
};

export type PatternTripletList = {
  pattern: "triplet_list";
  title: string;         // 列表小标题（红下划线），≤ 20 字
  items: string[];       // 2–5 条编号项，每条 ≤ 80 字
};

export type PatternSceneWithQuotes = {
  pattern: "scene_with_quotes";
  scene: string;         // 场景叙述
  quotes: string[];      // 引号引用，逐条独立缩进
};

export type PatternCaseBox = {
  pattern: "case_box";
  label?: string;        // 默认 "举个例子"
  punch?: string;        // 顶部一行小红字（"客户最大的焦虑是…"）
  wrong?: string;        // 可选 ✘ 行
  right?: string;        // 可选 ✓ 行
  quote?: string;        // 可选缩进引文
  body?: string;         // 兜底正文
};

export type PatternHighlight = {
  pattern: "highlight";
  text: string;          // ≤ 30 字金句
};

export type PatternSummary = {
  pattern: "summary";
  text: string;          // 文末结论
};

export type SectionPattern =
  | PatternFreeParagraph
  | PatternCentralNegation
  | PatternTripletCircles
  | PatternContrastCard
  | PatternFormulaChain
  | PatternTripletList
  | PatternSceneWithQuotes
  | PatternCaseBox
  | PatternHighlight
  | PatternSummary;

export type PosterSection = {
  no?: number;              // 章节编号，1 起；可省（标题/总览不算章节）
  label?: string;           // 章节标签（"现象 / 真实原因 / 道德经的答案 / 三步做法"等）
  body: SectionPattern[];   // 一个章节可包含 1–4 个 pattern
  source: string;           // 该 section 覆盖的原文字符（用于校验）
};

export type PosterDocumentV2 = {
  title: string;
  overview?: string[];      // 顶部 3–4 个圈圈关键词（≤ 4 字）
  sections: PosterSection[];
};

export type ImageAspectRatio = "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "2:3" | "3:2";
export type ImageResolution = "1k" | "2k" | "4k";

export type AiSettings = {
  imageModels: AiModelConfig[];
  languageModels: AiModelConfig[];
  imagePrompts: PromptPreset[];
  diagramPrompts: PromptPreset[];
  selectedImageModelId: string;
  selectedLanguageModelId: string;
};

export type AiImageRequest = {
  model: AiModelConfig;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
};

export type AiImageResult = {
  dataUrl: string;
  mimeType: string;
};

/** 插入画布后回传的图片元数据，便于上层做导航/居中。 */
export type InsertedAiImage = {
  elementId: string;
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AiDiagramRequest = {
  model: AiModelConfig;
  prompt: string;
  diagramKind: PosterTheme;
};

export type AiDiagramResult = {
  title?: string;
  modules: PosterModule[];
};

export type AiTestResult = {
  ok: boolean;
  message: string;
};

export type PosterSkeleton = ExcalidrawElementSkeleton;
