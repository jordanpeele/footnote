// Footnote adjudication cockpit — the browser page. Loads queue.json (produced by
// prep.js), walks it one card at a time with keyboard-driven controls, accumulates
// decisions, and downloads graduations.json for apply.js. Zero deps; imports the shared
// pure logic (CATEGORIES/VERDICTS) from lib.js so the picker order and the graduation
// math can't drift between the page and apply.js.
import { CATEGORIES, VERDICTS } from "/tools/adjudicate/lib.js";

const state = {
  queue: null,
  entries: [],
  idx: 0,
  decisions: {},      // key -> decision object
  order: [],          // keys in walk order
};

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $("status").textContent = msg; };

async function boot() {
  let q;
  try {
    const res = await fetch("/tools/adjudicate/queue.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    q = await res.json();
  } catch (e) {
    $("progress-label").textContent = "queue.json missing — run: node tools/adjudicate/prep.js";
    setStatus("could not load queue.json (" + e.message + ")");
    return;
  }
  state.queue = q;
  state.entries = q.entries || [];
  state.order = state.entries.map((e) => e.key);
  buildPickers();
  bindKeys();
  $("btn-decide").addEventListener("click", () => decideAndNext());
  $("btn-skip").addEventListener("click", () => skip());
  $("btn-back").addEventListener("click", () => back());
  $("btn-batch").addEventListener("click", () => batchAccept());
  $("btn-download").addEventListener("click", () => download());
  render();
}

function buildPickers() {
  const vb = $("verdict-buttons");
  vb.innerHTML = "";
  for (const v of VERDICTS) {
    const b = document.createElement("button");
    b.className = "pill";
    b.dataset.verdict = v.value;
    b.innerHTML = `${v.value} <kbd>${v.key}</kbd>`;
    b.addEventListener("click", () => setVerdict(v.value));
    vb.appendChild(b);
  }
  const cb = $("category-buttons");
  cb.innerHTML = "";
  CATEGORIES.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "pill";
    b.dataset.category = c.name;
    b.innerHTML = `${c.name} <kbd>${i + 1}</kbd>`;
    b.addEventListener("click", () => setCategory(c.name));
    cb.appendChild(b);
  });
}

// Get (or seed) the working decision for the current card.
function current() { return state.entries[state.idx]; }
function decisionFor(entry) {
  if (!state.decisions[entry.key]) {
    state.decisions[entry.key] = {
      key: entry.key,
      verdict: entry.suggestedVerdict || null,
      category: entry.suggestedCategory || null,
      extraction: entry.canonical,
      note: "",
      source_of_truth: "",
      skip: false,
    };
  }
  return state.decisions[entry.key];
}

function setVerdict(v) { const d = decisionFor(current()); d.verdict = d.verdict === v ? null : v; render(); }
function setCategory(c) { const d = decisionFor(current()); d.category = c; render(); }

function render() {
  const total = state.entries.length;
  const decided = Object.values(state.decisions).filter((d) => d.skip || d.category).length;
  $("progress-fill").style.width = total ? `${Math.round((state.idx / total) * 100)}%` : "0%";
  $("progress-label").textContent = `${state.idx + 1} / ${total} · ${decided} resolved`;

  if (state.idx >= total) return showDone();
  $("card").hidden = false; $("done").hidden = true;

  const e = current();
  const d = decisionFor(e);
  $("repeat-badge").textContent = e.repeatCount > 1 ? `×${e.repeatCount} repeats` : "unique";
  $("source-drafts").textContent = e.sourceDrafts.join(", ");
  $("pipeline-hint").textContent = e.pipelineVerdict ? `pipeline hint: ${e.pipelineVerdict} (NOT ground truth)` : "";

  $("extraction").value = d.extraction ?? "";
  $("transcript").textContent = e.sampleTranscript || "(no transcript sample)";
  $("source").value = d.source_of_truth || "";
  $("note").value = d.note || "";

  for (const b of $("verdict-buttons").children) {
    b.classList.toggle("sel", b.dataset.verdict === d.verdict);
    b.classList.toggle("suggested", !d.verdict && b.dataset.verdict === e.suggestedVerdict);
  }
  for (const b of $("category-buttons").children) {
    b.classList.toggle("sel", b.dataset.category === d.category);
    b.classList.toggle("suggested", !d.category && b.dataset.category === e.suggestedCategory);
  }

  // Batch button: how many later cards share this exact (verdict, category)?
  const like = batchGroup(d).length;
  const bb = $("btn-batch");
  bb.hidden = !(d.verdict && d.category && like > 1);
  if (!bb.hidden) bb.textContent = `Accept all ${like} like this (${d.verdict} · ${d.category})`;

  $("btn-back").disabled = state.idx === 0;
  setStatus("");
}

// Cards from the current index onward whose SUGGESTED verdict+category match the current
// decision — the "accept all N like this" group (batch mode over identical suggestions).
function batchGroup(d) {
  const out = [];
  for (let i = state.idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    const existing = state.decisions[e.key];
    if (existing && (existing.skip || existing.category)) continue; // don't clobber resolved
    if (e.suggestedVerdict === d.verdict && e.suggestedCategory === d.category) out.push(e);
  }
  return out;
}

function pullFields() {
  const d = decisionFor(current());
  d.extraction = $("extraction").value.trim() || null;
  d.source_of_truth = $("source").value.trim();
  d.note = $("note").value.trim();
}

function decideAndNext() {
  pullFields();
  const d = decisionFor(current());
  if (!d.category) { setStatus("pick a category first (number keys or click)"); return; }
  if (!d.verdict && d.extraction !== null) {
    setStatus("pick a verdict, or clear the extraction to graduate as a null-verdict echo/opinion card");
    return;
  }
  d.skip = false;
  next();
}

function skip() { pullFields(); const d = decisionFor(current()); d.skip = true; d.category = d.category || null; next(); }
function next() { state.idx = Math.min(state.idx + 1, state.entries.length); render(); }
function back() { if (state.idx > 0) { state.idx--; render(); } }

function batchAccept() {
  pullFields();
  const d = decisionFor(current());
  if (!d.verdict || !d.category) { setStatus("need verdict + category to batch"); return; }
  const group = batchGroup(d);
  for (const e of group) {
    const gd = decisionFor(e);
    gd.verdict = d.verdict; gd.category = d.category; gd.skip = false;
    // keep each card's own extraction/transcript; batch only ratifies verdict+category
  }
  setStatus(`accepted ${group.length} cards as ${d.verdict} · ${d.category}`);
  // jump to the next still-unresolved card
  while (state.idx < state.entries.length) {
    const e = state.entries[state.idx];
    const dd = state.decisions[e.key];
    if (!dd || (!dd.skip && !dd.category)) break;
    state.idx++;
  }
  render();
}

function showDone() {
  $("card").hidden = true; $("done").hidden = false;
  const vals = Object.values(state.decisions);
  const graduating = vals.filter((d) => !d.skip && d.category).length;
  const skipped = vals.filter((d) => d.skip).length;
  $("done-summary").textContent =
    `${graduating} card(s) to graduate, ${skipped} skipped, ${state.entries.length - vals.length} untouched. ` +
    `Download graduations.json, then: node tools/adjudicate/apply.js`;
  $("progress-fill").style.width = "100%";
}

function download() {
  const decisions = Object.values(state.decisions);
  const payload = {
    generated_at: new Date().toISOString(),
    source_queue: state.queue?.generated_at || null,
    decisions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "graduations.json";
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`downloaded ${decisions.length} decision(s)`);
}

function bindKeys() {
  document.addEventListener("keydown", (ev) => {
    const t = ev.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    if (typing && ev.key !== "Enter") return;         // let fields take normal input
    if (ev.key === "Enter") {
      if (state.idx >= state.entries.length) return;
      ev.preventDefault(); decideAndNext(); return;
    }
    if (state.idx >= state.entries.length) {
      if (ev.key === "d") { ev.preventDefault(); download(); }
      return;
    }
    const v = VERDICTS.find((x) => x.key === ev.key);
    if (v) { ev.preventDefault(); setVerdict(v.value); return; }
    if (/^[1-9]$/.test(ev.key)) {
      const c = CATEGORIES[Number(ev.key) - 1];
      if (c) { ev.preventDefault(); setCategory(c.name); } return;
    }
    if (ev.key === "s") { ev.preventDefault(); skip(); return; }
    if (ev.key === "b") { ev.preventDefault(); back(); return; }
    if (ev.key === "d") { ev.preventDefault(); download(); return; }
  });
}

boot();
