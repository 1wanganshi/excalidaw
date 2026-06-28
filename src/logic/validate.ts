import type { LogicManuscriptIR } from "./types";

export type CoverageResult = {
  ok: boolean;
  message: string;
  coveragePercent: number;
};

export function validateIrCoverage(ir: LogicManuscriptIR): CoverageResult {
  const joined = ir.sentences.map((s) => ir.normalized.slice(s.start, s.end)).join("");
  const strip = (t: string) => t.replace(/[\s　​‌‍﻿]+/g, "");

  const srcNorm = strip(ir.normalized);
  const joinedNorm = strip(joined);

  if (srcNorm.length === 0) {
    return { ok: false, message: "请输入要绘制的内容。", coveragePercent: 0 };
  }

  const coveragePercent =
    srcNorm.length > 0 ? Math.round((joinedNorm.length / srcNorm.length) * 100) : 100;

  if (joinedNorm !== srcNorm) {
    return {
      ok: false,
      message: `原文覆盖 ${coveragePercent}%，切分后与原文不一致（${joinedNorm.length}/${srcNorm.length} 字）。`,
      coveragePercent,
    };
  }

  return { ok: true, message: `原文覆盖 100%（${srcNorm.length} 字）。`, coveragePercent: 100 };
}
