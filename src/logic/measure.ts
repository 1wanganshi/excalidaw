export function charWidth(ch: string, fs: number): number {
  const code = ch.charCodeAt(0);
  if (/\s/.test(ch)) return fs * 0.35;
  if (code > 0x7f) return fs * 1.08;
  if (/[A-Z0-9]/.test(ch)) return fs * 0.68;
  if (".,:;!?|/\\()[]{}'\"`~-–—_+=<>".includes(ch)) return fs * 0.46;
  return fs * 0.62;
}

export function textWidth(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, fs);
  return w;
}

export function wrap(text: string, fs: number, maxW: number): string[] {
  if (!text) return [""];
  const safe = Math.max(fs * 2, maxW * 0.92);
  const noLineStart = "。，、；：！？）」』】〗》〕…—·．,.;:!?)]}";
  const noLineEnd = "「『（〖《〔【([{";
  const raw: string[] = [];

  for (const para of text.split(/\r?\n/)) {
    if (!para.length) {
      raw.push("");
      continue;
    }
    let cur = "";
    let curW = 0;
    let i = 0;
    while (i < para.length) {
      const ch = para[i];
      let chunk = ch;
      let cw: number;
      if (ch.charCodeAt(0) <= 0x7f && ch !== " ") {
        let j = i;
        while (j < para.length) {
          const nc = para[j];
          if (nc.charCodeAt(0) > 0x7f || nc === " ") break;
          j += 1;
        }
        chunk = para.slice(i, j);
        cw = textWidth(chunk, fs);
        i = j;
      } else {
        cw = charWidth(ch, fs);
        i += 1;
      }
      if (curW + cw > safe && cur.length > 0) {
        raw.push(cur.trimEnd());
        cur = chunk.trimStart();
        curW = textWidth(cur, fs);
      } else {
        cur += chunk;
        curW += cw;
      }
    }
    if (cur.length > 0) raw.push(cur.trimEnd());
    else raw.push("");
  }

  const out: string[] = [];
  for (let li = 0; li < raw.length; li += 1) {
    let line = raw[li];
    while (line.length > 0 && out.length > 0 && noLineStart.includes(line[0])) {
      out[out.length - 1] = out[out.length - 1] + line[0];
      line = line.slice(1);
    }
    while (line.length > 1 && noLineEnd.includes(line[line.length - 1]) && li + 1 < raw.length) {
      raw[li + 1] = line[line.length - 1] + raw[li + 1];
      line = line.slice(0, -1);
    }
    out.push(line);
  }
  return out.length > 0 ? out : [""];
}

export function lineH(fs: number): number {
  return Math.round(fs * 1.68);
}

export function glyphH(fs: number, lines: number): number {
  return Math.round(fs * 1.25 * Math.max(1, lines));
}

export function measure(text: string, fs: number, maxW: number) {
  const lines = wrap(text, fs, maxW);
  const h = lineH(fs) * lines.length;
  let maxLine = 0;
  for (const l of lines) {
    const w = textWidth(l, fs);
    if (w > maxLine) maxLine = w;
  }
  return { lines, h, w: maxLine };
}
