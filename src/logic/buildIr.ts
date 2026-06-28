import type { LogicExportMode, LogicManuscriptIR } from "./types";
import { splitSentences } from "./splitSentences";
import {
  assignSentenceRoles,
  buildChains,
  detectEmphasis,
  detectTitle,
  extractKeywordRange,
  recognizeEdges,
} from "./recognize";

export function buildLogicManuscriptIR(source: string, exportMode: LogicExportMode): LogicManuscriptIR {
  const { sentences, normalized } = splitSentences(source);
  assignSentenceRoles(sentences, normalized);
  const { title, subtitle } = detectTitle(sentences, normalized);
  const edges = recognizeEdges(sentences, normalized);
  const chains = buildChains(sentences, edges, normalized);
  const emphasis = detectEmphasis(sentences, normalized);

  for (const s of sentences) {
    const kw = extractKeywordRange(s, normalized);
    s.displayStart = kw.start;
    s.displayEnd = kw.end;
  }

  return {
    source,
    normalized,
    export: exportMode,
    title,
    subtitle,
    sentences,
    chains,
    edges,
    emphasis,
  };
}
