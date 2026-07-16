/**
 * CEO kappa rating sheet generator (CEO plan step 5, KPI C.1 mirror).
 *
 * Samples ~28 scored (query, result) items, writes:
 *   - kappa-judge-scores.json — the JUDGE's hidden answer key (relevance+credibility).
 *   - kappa-rating-sheet.html — a blank standalone form for the founder to rate
 *     the SAME items on the SAME 0-2 rubric, with the judge's scores hidden, plus
 *     a "copy results as JSON" button.
 *
 * Run AFTER run-search.ts. Do NOT compute kappa here (no self-rated data) — the
 * founder rates, then scripts/compute-kappa.ts compares.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "out");
const SAMPLE_SIZE = 28;

interface Scored {
  engine: string;
  queryId: string;
  topic: string;
  level: string;
  query: string;
  url: string;
  title: string;
  snippet: string;
  relevance: number;
  credibility: number;
}

// Deterministic shuffle (seeded) so the sample is reproducible.
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function main() {
  const bundle = JSON.parse(readFileSync(join(OUT_DIR, "search-results.json"), "utf8")) as { scored: Scored[] };
  const all = bundle.scored;

  // Dedup by (query,url) and spread the sample across topics + score levels so the
  // founder rates a representative mix (not 28 Wikipedia hits).
  const seen = new Set<string>();
  const unique = all.filter((s) => {
    const k = `${s.queryId}|${s.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const shuffled = seededShuffle(unique, 20260603);

  // Stratify: round-robin across topics to balance the sample.
  const byTopic: Record<string, Scored[]> = {};
  for (const s of shuffled) (byTopic[s.topic] ??= []).push(s);
  const topics = Object.keys(byTopic);
  const sample: Scored[] = [];
  let idx = 0;
  while (sample.length < SAMPLE_SIZE && topics.some((t) => byTopic[t][idx])) {
    for (const t of topics) {
      if (byTopic[t][idx]) sample.push(byTopic[t][idx]);
      if (sample.length >= SAMPLE_SIZE) break;
    }
    idx++;
  }

  const items = sample.map((s, i) => ({
    itemId: `k${i + 1}`,
    queryId: s.queryId,
    topic: s.topic,
    level: s.level,
    query: s.query,
    title: s.title,
    url: s.url,
    snippet: s.snippet,
  }));

  const answerKey = sample.map((s, i) => ({
    itemId: `k${i + 1}`,
    queryId: s.queryId,
    url: s.url,
    judgeRelevance: s.relevance,
    judgeCredibility: s.credibility,
  }));
  writeFileSync(join(OUT_DIR, "kappa-judge-scores.json"), JSON.stringify({ rubric: "0-2 relevance + 0-2 credibility", items: answerKey }, null, 2));

  const rows = items
    .map(
      (it) => `
  <div class="item" data-id="${it.itemId}">
    <div class="item-head"><span class="pill">${esc(it.itemId)}</span> <span class="topic">${esc(it.topic)} · ${esc(it.level)}</span></div>
    <div class="query"><b>Query:</b> ${esc(it.query)}</div>
    <div class="title">${esc(it.title)}</div>
    <a class="url" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a>
    <div class="snippet">${esc(it.snippet || "(no snippet)")}</div>
    <div class="axes">
      <div class="axis">
        <span class="axis-label">Relevance / level (0–2)</span>
        ${[0, 1, 2].map((v) => `<label><input type="radio" name="${it.itemId}_rel" value="${v}"> ${v}</label>`).join("")}
      </div>
      <div class="axis">
        <span class="axis-label">Credibility (0–2)</span>
        ${[0, 1, 2].map((v) => `<label><input type="radio" name="${it.itemId}_cred" value="${v}"> ${v}</label>`).join("")}
      </div>
    </div>
  </div>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>L2 Eval — CEO Kappa Rating Sheet</title>
<style>
  :root{--bg:#f7f8fa;--surface:#fff;--ink:#1c2024;--soft:#5a626b;--line:#e4e7eb;--accent:#2f57d6;--accent-bg:#eef2fe;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:32px 16px;}
  .wrap{max-width:780px;margin:0 auto;}
  h1{font-size:22px;margin:0 0 4px;}
  .lede{color:var(--soft);font-size:14px;margin:0 0 24px;}
  .item{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:14px 0;}
  .item-head{display:flex;gap:10px;align-items:center;margin-bottom:8px;}
  .pill{background:var(--accent-bg);color:var(--accent);font-weight:700;font-size:12px;padding:2px 8px;border-radius:999px;}
  .topic{font-size:12px;color:var(--soft);text-transform:uppercase;letter-spacing:.04em;}
  .query{font-size:14px;margin:4px 0;}
  .title{font-weight:600;margin:6px 0 2px;}
  .url{font-size:12px;color:var(--accent);word-break:break-all;}
  .snippet{font-size:13px;color:var(--soft);margin:8px 0 12px;line-height:1.5;}
  .axes{display:flex;gap:28px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px;}
  .axis-label{display:block;font-size:12px;font-weight:700;color:var(--soft);margin-bottom:4px;}
  .axis label{margin-right:12px;font-size:14px;cursor:pointer;}
  .bar{position:sticky;bottom:0;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin-top:20px;display:flex;gap:14px;align-items:center;box-shadow:0 -2px 8px rgba(0,0,0,.05);}
  button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;}
  #status{font-size:13px;color:var(--soft);}
  textarea{width:100%;height:120px;margin-top:12px;font-family:monospace;font-size:12px;display:none;}
</style></head>
<body><div class="wrap">
  <h1>L2 Eval — CEO Kappa Rating Sheet</h1>
  <p class="lede">Rate each search result on the SAME 0–2 rubric the LLM judge used. The judge's scores are hidden.
  <b>Relevance/level:</b> 0 = off-topic/wrong level · 1 = related but partial · 2 = directly useful at the learner's level.
  <b>Credibility:</b> 0 = spam/forum/unattributable · 1 = acceptable · 2 = authoritative (educational/encyclopedic/expert).
  Open the URL if unsure. ~${items.length} items, ~20–30 min. Then click <b>Copy results as JSON</b> and paste back.</p>
  ${rows}
  <div class="bar">
    <button onclick="copyResults()">Copy results as JSON</button>
    <span id="status"></span>
  </div>
  <textarea id="json" readonly></textarea>
</div>
<script>
  const ITEM_IDS = ${JSON.stringify(items.map((i) => i.itemId))};
  function collect(){
    const ratings = ITEM_IDS.map(id => {
      const rel = document.querySelector('input[name="'+id+'_rel"]:checked');
      const cred = document.querySelector('input[name="'+id+'_cred"]:checked');
      return { itemId:id, relevance: rel?Number(rel.value):null, credibility: cred?Number(cred.value):null };
    });
    return ratings;
  }
  function copyResults(){
    const ratings = collect();
    const missing = ratings.filter(r => r.relevance===null || r.credibility===null).length;
    const payload = JSON.stringify({ rater:"CEO", ratings }, null, 2);
    const ta = document.getElementById('json'); ta.style.display='block'; ta.value = payload; ta.select();
    navigator.clipboard?.writeText(payload).catch(()=>{});
    document.getElementById('status').textContent = missing>0
      ? ('Copied — WARNING: '+missing+' item(s) unrated.')
      : 'Copied all '+ratings.length+' ratings to clipboard.';
  }
</script>
</body></html>`;

  writeFileSync(join(OUT_DIR, "kappa-rating-sheet.html"), html);
  console.log(`Wrote kappa-rating-sheet.html (${items.length} items) + kappa-judge-scores.json`);
}

main();
