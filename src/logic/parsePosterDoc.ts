import type {
  PosterDocumentV2,
  PosterSection,
  SectionPattern,
} from "../types";

function s(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strArr(value: unknown, perMax = 80): string[] {
  return arr(value)
    .map((it) => s(it, perMax))
    .filter((t) => t.length > 0);
}

function clampLabel(label: string | undefined, max = 8): string | undefined {
  if (!label) return label;
  const clean = label.replace(/[。！？；;：:]+$/, "").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max);
}

function parsePattern(raw: unknown): SectionPattern | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = s(o.pattern, 32);

  switch (kind) {
    case "highlight": {
      const text = s(o.text, 60);
      if (!text) return null;
      return { pattern: "highlight", text };
    }
    case "summary": {
      const text = s(o.text, 120);
      if (!text) return null;
      return { pattern: "summary", text };
    }
    case "free_paragraph": {
      let text = "";
      if (typeof o.text === "string") text = s(o.text, 600);
      else if (Array.isArray(o.refs)) text = strArr(o.refs, 200).join("");
      if (!text) return null;
      const emphasis = o.emphasis === "red" ? "red" : "normal";
      return { pattern: "free_paragraph", text, emphasis };
    }
    case "contrast_card": {
      const wrong = s(o.wrong, 80);
      const right = s(o.right, 80);
      if (!wrong || !right) return null;
      return {
        pattern: "contrast_card",
        wrong,
        right,
        wrong_label: s(o.wrong_label, 8) || undefined,
        right_label: s(o.right_label, 8) || undefined,
      };
    }
    case "formula_chain": {
      const items = strArr(o.items, 16);
      if (items.length < 2) return null;
      return { pattern: "formula_chain", items: items.slice(0, 5) };
    }
    case "triplet_list": {
      const items = strArr(o.items, 80);
      if (items.length === 0) return null;
      return {
        pattern: "triplet_list",
        title: s(o.title, 22),
        items: items.slice(0, 6),
      };
    }
    case "triplet_circles": {
      const items = strArr(o.items, 6);
      if (items.length < 2) return null;
      return { pattern: "triplet_circles", items: items.slice(0, 4) };
    }
    case "scene_with_quotes": {
      const scene = s(o.scene, 240);
      const quotes = strArr(o.quotes, 80);
      if (!scene && quotes.length === 0) return null;
      return {
        pattern: "scene_with_quotes",
        scene,
        quotes: quotes.slice(0, 4),
      };
    }
    case "case_box": {
      const label = s(o.label, 10);
      const punch = s(o.punch, 60);
      const wrong = s(o.wrong, 80);
      const right = s(o.right, 80);
      const quote = s(o.quote, 120);
      const body = s(o.body, 320);
      if (!punch && !wrong && !right && !quote && !body) return null;
      return {
        pattern: "case_box",
        label: label || undefined,
        punch: punch || undefined,
        wrong: wrong || undefined,
        right: right || undefined,
        quote: quote || undefined,
        body: body || undefined,
      };
    }
    case "central_negation": {
      const center = s(o.center, 10);
      const options = strArr(o.options, 12);
      if (!center || options.length < 2) return null;
      return {
        pattern: "central_negation",
        center,
        options: options.slice(0, 6),
      };
    }
    default:
      return null;
  }
}

function dedupAdjacent(body: SectionPattern[]): SectionPattern[] {
  if (body.length < 2) return body;
  const out: SectionPattern[] = [body[0]];
  for (let i = 1; i < body.length; i += 1) {
    const prev = out[out.length - 1];
    if (prev.pattern === body[i].pattern && prev.pattern === "free_paragraph") {
      const text = `${(prev as { text: string }).text}\n\n${(body[i] as { text: string }).text}`;
      out[out.length - 1] = { ...(prev as object), text } as SectionPattern;
      continue;
    }
    out.push(body[i]);
  }
  return out;
}

function parseSection(raw: unknown, fallbackNo: number): PosterSection | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const body = arr(o.body ?? o.patterns)
    .map(parsePattern)
    .filter((p): p is SectionPattern => p !== null);
  if (body.length === 0) return null;
  const no = typeof o.no === "number" && o.no > 0 ? Math.floor(o.no) : fallbackNo;
  return {
    no,
    label: clampLabel(s(o.label, 60)) || undefined,
    body: dedupAdjacent(body),
    source: "",
  };
}

/**
 * 把 LLM 直出的 JSON 解析为合法 PosterDocumentV2。
 * 与 resolveLayoutPlan 不同：不引用句子 ID，不校验全文覆盖。
 * 任何无效字段会被静默丢弃。
 */
export function parsePosterDocV2(raw: unknown): PosterDocumentV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const rawSections = arr(o.sections);
  const sections = rawSections
    .map((sec, i) => parseSection(sec, i + 1))
    .filter((sec): sec is PosterSection => sec !== null);

  if (sections.length === 0) return null;

  const overview = strArr(o.overview, 6);
  const title = s(o.title, 60) || "白板长图";

  return {
    title,
    overview: overview.length >= 2 ? overview.slice(0, 4) : undefined,
    sections,
  };
}
