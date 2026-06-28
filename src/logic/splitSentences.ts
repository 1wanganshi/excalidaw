import type { LogicSentence } from "./types";

const SENTENCE_END = /[。！？；!?;]/;
const CLOSING_AFTER = /^[」』"')\]】]+/;

export function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

function isInsideQuotes(text: string, index: number): boolean {
  let asciiQuote = false;
  let cnQuote = false;
  for (let i = 0; i < index; i += 1) {
    const ch = text[i];
    if (ch === "\"") asciiQuote = !asciiQuote;
    if (ch === "「" || ch === "『") cnQuote = true;
    if (ch === "」" || ch === "』") cnQuote = false;
  }
  return asciiQuote || cnQuote;
}

export function splitSentences(source: string): { sentences: LogicSentence[]; normalized: string } {
  const normalized = normalizeSource(source);
  const sentences: LogicSentence[] = [];
  let id = 0;
  let i = 0;

  while (i < normalized.length) {
    let start = i;
    while (start < normalized.length && /\s/.test(normalized[start])) start += 1;
    if (start >= normalized.length) break;

    let end = start;

    while (end < normalized.length) {
      const ch = normalized[end];
      if (SENTENCE_END.test(ch) && !isInsideQuotes(normalized, end)) {
        end += 1;
        const rest = normalized.slice(end);
        const closeMatch = rest.match(CLOSING_AFTER);
        if (closeMatch) {
          end += closeMatch[0].length;
        }
        break;
      }
      end += 1;
    }

    if (end === start) {
      break;
    }

    const slice = normalized.slice(start, end);
    if (slice.trim().length > 0) {
      sentences.push({ id: `s${id++}`, start, end });
    }

    i = end;
  }

  if (sentences.length === 0 && normalized.trim().length > 0) {
    sentences.push({ id: "s0", start: 0, end: normalized.length });
  }

  return { sentences, normalized };
}

export function sentenceText(normalized: string, sentence: LogicSentence): string {
  return normalized.slice(sentence.start, sentence.end).trim();
}

export function markParagraphBreaks(sentences: LogicSentence[], normalized: string): void {
  for (let i = 1; i < sentences.length; i += 1) {
    const gap = normalized.slice(sentences[i - 1].end, sentences[i].start);
    if (/\n\s*\n/.test(gap)) {
      sentences[i].paragraphStart = true;
    }
  }
}
