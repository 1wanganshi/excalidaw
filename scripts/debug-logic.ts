import { readFileSync } from "node:fs";
import { buildLogicManuscriptIR } from "../src/logic/buildIr.ts";
import { sentenceText } from "../src/logic/splitSentences.ts";
import { validateIrCoverage } from "../src/logic/validate.ts";
import { renderLogicManuscript } from "../src/logic/render.ts";

const text = readFileSync(new URL("./sample-article.txt", import.meta.url), "utf8");
const ir = buildLogicManuscriptIR(text, "lecture");
const check = validateIrCoverage(ir);
const layout = renderLogicManuscript(ir, "whiteboard", { x: 0, y: 0 });

console.log("Coverage:", check.message);
console.log(`Sentences: ${ir.sentences.length} | Edges: ${ir.edges.length} | Chains: ${ir.chains.length} | Elements: ${layout.elements.length}`);
console.log("\nRoles:");
for (const s of ir.sentences) {
  console.log(`  ${s.id} ${s.role ?? "body"}${s.paragraphStart ? " [¶]" : ""} | ${sentenceText(ir.normalized, s).slice(0, 42)}`);
}
console.log("\nEdges:");
for (const e of ir.edges) {
  const f = sentenceText(ir.normalized, ir.sentences.find((x) => x.id === e.from)!);
  const t = sentenceText(ir.normalized, ir.sentences.find((x) => x.id === e.to)!);
  console.log(`  ${e.relation}: ${f.slice(0, 20)} → ${t.slice(0, 20)}`);
}
console.log("\nChains:");
for (const c of ir.chains) {
  console.log(`  ${c.kind}: ${c.sentenceIds.length} sents`);
}
