/** AI 布局计划：只引用句子 ID，不携带改写文字（本地注入原文） */

export type AiPatternPlan =
  | { pattern: "free_paragraph"; refs: string[]; emphasis?: "normal" | "red" }
  | { pattern: "highlight"; ref: string }
  | { pattern: "summary"; ref: string }
  | { pattern: "contrast_card"; ref: string }
  | { pattern: "formula_chain"; ref: string }
  | { pattern: "triplet_list"; titleRef?: string; refs: string[] }
  | { pattern: "scene_with_quotes"; sceneRefs: string[]; quoteRefs: string[] }
  | { pattern: "case_box"; refs: string[] }
  | { pattern: "central_negation"; center: string; refs: string[] }
  | { pattern: "triplet_circles"; items: string[] };

export type AiLogicSectionPlan = {
  no?: number;
  label?: string;
  patterns: AiPatternPlan[];
};

export type AiLogicLayoutPlan = {
  titleRef?: string;
  overview?: string[];
  sections: AiLogicSectionPlan[];
};
