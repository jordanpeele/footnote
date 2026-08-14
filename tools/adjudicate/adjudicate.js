// Footnote adjudication cockpit — the browser page. Loads queue.json (produced by
// prep.js), walks it one card at a time with keyboard-driven controls, accumulates
// decisions, and downloads graduations.json for apply.js. Zero deps; imports the shared
// pure logic (CATEGORIES/VERDICTS) from lib.js so the picker order and the graduation
// math can't drift between the page and apply.js.
//
// Sitting-speed features:
// - cards arrive pre-clustered (prep.js): same suggested category+verdict runs are
//   contiguous, so "Accept all N like this" (or the `a` key) eats a cluster at once
// - decisions autosave to localStorage (keyed by the queue's generated_at) — a reload
//   mid-sitting resumes where you left off
// - progress label shows resolved count + a remaining-time estimate from your own pace
// - only EXPLICITLY resolved cards (Enter / skip / batch) are downloaded — a merely
//   visited card with a pre-seeded suggestion never lands in graduations.json
import { CATEGORIES, VERDICTS } from "/tools/adjudicate/lib.js";

const state = {
  queue: null,
  entries: [],
  idx: 0,
  decisions: {},      // key -> decision object
  marks: [],          // Date.now() of each resolution, for the pace estimate
};

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $("status").textContent = msg; };
const storageKey = () => "footnote-adjudication-" + (state.queue?.generated_at || "unknown");

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
  buildPickers();
  bindKeys();
  $("btn-decide").addEventListener("click", () => decideAndNext());
  $("btn-skip").addEventListener("click", () => skip());
  $("btn-back").addEventListener("click", () => back());
  $("btn-batch").addEventListener("click", () => batchAccept());
  $("btn-download").addEventListener("click", () => download());
  $("btn-download-top").addEventListener("click", () => download());
  $("btn-reset").addEventListener("click", () => resetSitting());
  restore();
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
  const gap = new Map((state.queue.categoryStats || []).map((s) => [s.category, s]));
  CATEGORIES.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "pill";
    b.dataset.category = c.name;
    const s = gap.get(c.name);
    const need = s && s.needed > 0 ? ` <span class="need">+${s.needed}</span>` : "";
    b.innerHTML = `${c.name}${need} <kbd>${i + 1}</kbd>`;
    b.title = s ? `golden: ${s.current}/${s.target}${s.needed ? ` — needs ${s.needed} more` : " — at target"}` : "";
    b.addEventListener("click", () => setCategory(c.name));
    cb.appendChild(b);
  });
}

// ---- persistence ---------------------------------------------------------------------
function persist() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({
      idx: state.idx, decisions: state.decisions, marks: state.marks,
    }));
  } catch { /* storage full/blocked — the download button still works */ }
}
function restore() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.decisions = saved.decisions || {};
    state.marks = saved.marks || [];
    state.idx = Math.min(saved.idx || 0, state.entries.length);
    const n = resolvedDecisions().length;
    if (n) setTimeout(() => setStatus(`resumed — ${n} decision(s) restored from this browser`), 0);
  } catch { /* corrupt save — start clean */ }
}
function resetSitting() {
  if (!confirm("Discard all decisions for this sitting and start over?")) return;
  localStorage.removeItem(storageKey());
  state.decisions = {}; state.marks = []; state.idx = 0;
  render();
  setStatus("sitting reset");
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
      resolved: false,  // only Enter/skip/batch set this; unresolved cards never download
    };
  }
  return state.decisions[entry.key];
}
function isResolved(entry) { return !!state.decisions[entry.key]?.resolved; }
function resolvedDecisions() { return Object.values(state.decisions).filter((d) => d.resolved); }

function setVerdict(v) { const d = decisionFor(current()); d.verdict = d.verdict === v ? null : v; render(); }
function setCategory(c) { const d = decisionFor(current()); d.category = c; render(); }

// Remaining-time estimate from the operator's own pace (gaps > 2 min = a break, ignored).
function etaLabel(remaining) {
  const gaps = [];
  for (let i = 1; i < state.marks.length; i++) {
    const g = state.marks[i] - state.marks[i - 1];
    if (g > 0 && g < 120000) gaps.push(g);
  }
  if (!gaps.length || !remaining) return "";
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const min = Math.max(1, Math.round((avg * remaining) / 60000));
  return ` · ~${min} min left`;
}

function render() {
  const total = state.entries.length;
  const resolved = resolvedDecisions().length;
  const remaining = total - resolved;
  $("progress-fill").style.width = total ? `${Math.round((resolved / total) * 100)}%` : "0%";
  $("progress-label").textContent =
    `card ${Math.min(state.idx + 1, total)} / ${total} · ${resolved} resolved · ${remaining} left${etaLabel(remaining)}`;
  persist();

  if (state.idx >= total) return showDone();
  $("card").hidden = false; $("done").hidden = true;

  const e = current();
  const d = decisionFor(e);

  // Cluster bar: where am I in the batchable run, and how hungry is this category?
  let i0 = state.idx, i1 = state.idx;
  while (i0 > 0 && state.entries[i0 - 1].cluster === e.cluster) i0--;
  while (i1 < total - 1 && state.entries[i1 + 1].cluster === e.cluster) i1++;
  const stats = new Map((state.queue.categoryStats || []).map((s) => [s.category, s]));
  const cs = stats.get(d.category || e.suggestedCategory);
  const gapTxt = cs ? ` · golden ${cs.current}/${cs.target}${cs.needed ? ` (needs ${cs.needed})` : ""}` : "";
  $("cluster-bar").textContent =
    `cluster ${e.cluster || "—"} · card ${state.idx - i0 + 1}/${i1 - i0 + 1}${gapTxt}`;

  $("repeat-badge").textContent = e.repeatCount > 1 ? `×${e.repeatCount} repeats` : "unique";
  $("resolved-badge").hidden = !isResolved(e);
  $("resolved-badge").textContent = d.skip ? "skipped" : "resolved";
  $("source-drafts").textContent = e.sourceDrafts.join(", ");
  $("pipeline-hint").textContent = e.pipelineVerdict ? `pipeline hint: ${e.pipelineVerdict} (NOT ground truth)` : "";

  const hn = $("hint-note");
  hn.hidden = !e.hintNote;
  hn.textContent = e.hintNote ? `${e.hintRef ? "[" + e.hintRef + "] " : ""}${e.hintNote}` : "";

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
  if (!bb.hidden) bb.textContent = `Accept all ${like} like this (${d.verdict} · ${d.category})  [a]`;

  $("btn-back").disabled = state.idx === 0;
  setStatus("");
}

// Cards from the current index onward whose SUGGESTED verdict+category match the current
// decision — the "accept all N like this" group (batch mode over identical suggestions).
function batchGroup(d) {
  const out = [];
  for (let i = state.idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    if (state.decisions[e.key]?.resolved) continue; // don't clobber resolved
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

function mark() { state.marks.push(Date.now()); }

function decideAndNext() {
  pullFields();
  const d = decisionFor(current());
  if (!d.category) { setStatus("pick a category first (number keys or click)"); return; }
  if (!d.verdict && d.extraction !== null) {
    setStatus("pick a verdict, or clear the extraction to graduate as a null-verdict echo/opinion card");
    return;
  }
  d.skip = false;
  d.resolved = true;
  mark();
  next();
}

function skip() {
  pullFields();
  const d = decisionFor(current());
  d.skip = true;
  d.resolved = true;
  mark();
  next();
}

// Advance, hopping over already-resolved cards (batch-accepted runs walk themselves).
function next() {
  state.idx = Math.min(state.idx + 1, state.entries.length);
  while (state.idx < state.entries.length && isResolved(state.entries[state.idx])) state.idx++;
  render();
}
function back() { if (state.idx > 0) { state.idx--; render(); } }
// Jump to the next unresolved card (useful after backing into reviewed territory).
function jumpNextUnresolved() {
  let i = state.idx + 1;
  while (i < state.entries.length && isResolved(state.entries[i])) i++;
  state.idx = i;
  render();
}

function batchAccept() {
  pullFields();
  const d = decisionFor(current());
  if (!d.verdict || !d.category) { setStatus("need verdict + category to batch"); return; }
  const group = batchGroup(d);
  for (const e of group) {
    const gd = decisionFor(e);
    gd.verdict = d.verdict; gd.category = d.category; gd.skip = false; gd.resolved = true;
    // keep each card's own extraction/transcript; batch only ratifies verdict+category
  }
  mark(); // one pace-mark for the whole batch, so the ETA doesn't lie fast
  setStatus(`accepted ${group.length} cards as ${d.verdict} · ${d.category}`);
  // jump to the next still-unresolved card
  while (state.idx < state.entries.length && isResolved(state.entries[state.idx])) state.idx++;
  render();
}

function showDone() {
  $("card").hidden = true; $("done").hidden = false;
  const vals = resolvedDecisions();
  const graduating = vals.filter((d) => !d.skip).length;
  const skipped = vals.filter((d) => d.skip).length;
  $("done-summary").textContent =
    `${graduating} card(s) to graduate, ${skipped} skipped, ${state.entries.length - vals.length} unresolved (won't download). ` +
    `Download graduations.json, then: node tools/adjudicate/apply.js ~/Downloads/graduations.json`;
  $("progress-fill").style.width = "100%";
}

function download() {
  // Only explicitly resolved cards ship — a visited card with a pre-seeded suggestion
  // the human never ratified must NOT reach apply.js.
  const decisions = resolvedDecisions();
  if (!decisions.length) { setStatus("nothing resolved yet — nothing to download"); return; }
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
  setStatus(`downloaded ${decisions.length} resolved decision(s)`);
}

function bindKeys() {
  document.addEventListener("keydown", (ev) => {
    const t = ev.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    if (typing && ev.key === "Escape") { ev.preventDefault(); t.blur(); return; }
    if (typing && ev.key !== "Enter") return;         // let fields take normal input
    if (ev.key === "Enter") {
      if (state.idx >= state.entries.length) return;
      ev.preventDefault(); decideAndNext(); return;
    }
    if (state.idx >= state.entries.length) {
      if (ev.key === "d") { ev.preventDefault(); download(); }
      if (ev.key === "b") { ev.preventDefault(); back(); }
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
    if (ev.key === "j") { ev.preventDefault(); jumpNextUnresolved(); return; }
    if (ev.key === "a") { ev.preventDefault(); if (!$("btn-batch").hidden) batchAccept(); return; }
    if (ev.key === "e") { ev.preventDefault(); $("extraction").focus(); return; }
    if (ev.key === "o") { ev.preventDefault(); $("source").focus(); return; }
    if (ev.key === "i") { ev.preventDefault(); $("note").focus(); return; }
    if (ev.key === "d") { ev.preventDefault(); download(); return; }
  });
}

boot();
