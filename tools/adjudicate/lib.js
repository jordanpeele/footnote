// Footnote — adjudication cockpit: pure, testable logic shared by prep.js, apply.js,
// and the browser page. ZERO deps, ESM, no I/O in here — every function is a pure
// transform so the harness can unit-test the dedup + graduation math without a browser.
//
// The cockpit exists to make the eval sitting cheap: for six rounds, clearing the
// human-adjudication queue (eval/ADJUDICATION_QUEUE.md) has been ~2h of hand-editing
// JSONL. prep.js turns the three drafts-*.jsonl into a deduped work list (queue.json);
// the page walks it card-by-card and downloads graduations.json; apply.js mechanically
// appends each decision into eval/golden/<category>.jsonl with a fresh sequential id.

// The nine golden categories (dir eval/golden/<name>.jsonl) and their id prefixes.
// apply.js continues each file's id sequence; the page's number-key picker uses this
// order. Matched to the existing files' id conventions (person-020, stat-035, …).
export const CATEGORIES = [
  { name: "person_claims", prefix: "person" },
  { name: "statistics", prefix: "stat" },
  { name: "geography_civics", prefix: "geo" },
  { name: "science_health", prefix: "sci" },
  { name: "current_events", prefix: "curr" },
  { name: "historical_events", prefix: "hist" },
  { name: "adversarial", prefix: "adv" },
  { name: "attributed_quotes", prefix: "quote" },
  { name: "polarity_traps", prefix: "pol" },
];

// The five ground-truth verdicts the golden set uses, plus their cockpit hotkeys.
export const VERDICTS = [
  { key: "t", value: "True" },
  { key: "f", value: "False" },
  { key: "m", value: "Misleading" },
  { key: "n", value: "NeedsContext" },
  { key: "u", value: "Unverifiable" },
];

const PREFIX_BY_CATEGORY = new Map(CATEGORIES.map((c) => [c.name, c.prefix]));
export function prefixForCategory(category) {
  return PREFIX_BY_CATEGORY.get(category) || null;
}

// Normalize a claim string for dedup: lowercase, strip surrounding quotes/punctuation,
// collapse whitespace, drop trailing period. This is what collapses the 26 "Peter Thiel
// is the president…" repeats (and cross-session repeats like the Trump-president line)
// into ONE card. Deliberately conservative — it only folds claims that are the same
// sentence up to casing/spacing/trailing punctuation, never near-synonyms (those stay
// separate cards on purpose; the human decides whether to merge them).
export function normalizeClaim(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, (m) => (m === "‘" || m === "’" ? "'" : '"'))
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim();
}

// Pull a suggested category/verdict out of a draft's adjudication_note IF the note
// carries an explicit recommendation. The ingest-shaped notes only record the live
// PIPELINE verdict ("live pipeline said False @ conf 0.99"); that's a HINT, not ground
// truth (never adjudicate to self-agreement), so we surface it as `pipelineVerdict`
// separately and only treat an explicit "Recommend: <Verdict> · <category>" style note
// as a real suggestion. Returns {suggestedVerdict, suggestedCategory, pipelineVerdict}.
export function parseNoteHints(note) {
  const out = { suggestedVerdict: null, suggestedCategory: null, pipelineVerdict: null };
  if (!note) return out;
  const verdicts = VERDICTS.map((v) => v.value);
  // Live pipeline verdict (a hint only).
  const pm = /pipeline said\s+([A-Za-z]+)/i.exec(note);
  if (pm) {
    const hit = verdicts.find((v) => v.toLowerCase() === pm[1].toLowerCase());
    if (hit) out.pipelineVerdict = hit;
  }
  // Explicit recommendation, if an editor pre-seeded one into the draft note.
  const rm = /Recommend[a-z]*:?\s*\**([A-Za-z]+)/i.exec(note);
  if (rm) {
    const hit = verdicts.find((v) => v.toLowerCase() === rm[1].toLowerCase());
    if (hit) out.suggestedVerdict = hit;
  }
  for (const c of CATEGORIES) {
    if (note.includes(c.name)) { out.suggestedCategory = c.name; break; }
  }
  return out;
}

// Dedup a flat list of draft rows (each already parsed from JSONL, with a `_sourceDraft`
// tag naming its origin file) into the cockpit work list. One entry per unique
// normalized claim; repeats collapse with a count and the union of source draft ids.
// Rows with a null/empty expected_extraction (echo drafts, opinion-null) can't dedup by
// claim, so they each keep their own card keyed by draft id.
export function dedupeDrafts(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const claim = r.expected_extraction;
    const key = claim && claim.trim() ? "claim::" + normalizeClaim(claim) : "id::" + r.id;
    let e = byKey.get(key);
    if (!e) {
      const hints = parseNoteHints(r.adjudication_note);
      e = {
        key,
        claim: claim || null,
        canonical: claim || null,
        sampleTranscript: r.transcript_snippet || "",
        repeatCount: 0,
        sourceDrafts: [],
        suggestedCategory: hints.suggestedCategory,
        suggestedVerdict: hints.suggestedVerdict,
        pipelineVerdict: hints.pipelineVerdict,
      };
      byKey.set(key, e);
    }
    e.repeatCount += 1;
    e.sourceDrafts.push(r.id);
    // AUTHORED candidate rows (drafts-authored-*.jsonl) are written by an author with a
    // PROVISIONAL label + evidence note — not session ingests. Propagate the marker and
    // the fields the operator needs to ratify label+claim together: expected_polarity
    // rides through to the graduated golden entry (run.js/report.js read it for the
    // aired-verdict slice), the authored note surfaces in the hint panel, and the cited
    // source pre-fills the source field (all editable/overridable in the cockpit).
    if (r.authored) {
      e.authored = true;
      if (r.expected_polarity && !e.expected_polarity) e.expected_polarity = r.expected_polarity;
      if (!e.hintNote && r.adjudication_note) e.hintNote = r.adjudication_note;
      if (!e.sourceOfTruth && r.source_of_truth) e.sourceOfTruth = r.source_of_truth;
    }
    // Fill hints from any member that carries them (first non-null wins).
    if (!e.suggestedCategory || !e.suggestedVerdict) {
      const h = parseNoteHints(r.adjudication_note);
      e.suggestedCategory ||= h.suggestedCategory;
      e.suggestedVerdict ||= h.suggestedVerdict;
      e.pipelineVerdict ||= h.pipelineVerdict;
    }
  }
  // Stable order: most-repeated first (the big collapses lead), then by claim text.
  return [...byKey.values()].sort(
    (a, b) => b.repeatCount - a.repeatCount || String(a.claim).localeCompare(String(b.claim))
  );
}

// Merge sitting hints into deduped queue entries. hints.json is a TRANSCRIPTION of the
// pre-filled recommendations already authored in eval/ADJUDICATION_QUEUE.md (R1–R32 +
// the section policy clusters) plus factual run-log annotations for new drafts — it
// never invents rulings. A hint matches an entry by normalized claim (`claim`) or by
// draft-id membership (`draftIds` ∩ entry.sourceDrafts). Hints only FILL empty
// suggestion slots (a draft's own explicit "Recommend:" line wins) and attach
// hintNote/hintRef for display. Suggestions stay suggestions — the human ratifies or
// overrides every card in the cockpit; nothing here is ground truth.
export function applyHints(entries, hints) {
  if (!hints || !hints.length) return entries;
  const byClaim = new Map();
  const byDraftId = new Map();
  for (const h of hints) {
    if (h.claim) byClaim.set(normalizeClaim(h.claim), h);
    for (const id of h.draftIds || []) byDraftId.set(id, h);
  }
  for (const e of entries) {
    let h = e.claim ? byClaim.get(normalizeClaim(e.claim)) : null;
    if (!h) h = (e.sourceDrafts || []).map((id) => byDraftId.get(id)).find(Boolean) || null;
    if (!h) continue;
    e.suggestedVerdict ||= h.suggestedVerdict || null;
    e.suggestedCategory ||= h.suggestedCategory || null;
    if (h.note) e.hintNote = h.note;
    if (h.ref) e.hintRef = h.ref;
  }
  return entries;
}

// The cluster a card belongs to for the sitting: same-suggestion runs must be
// contiguous so ONE ruling (batch-accept) covers all N cards in a row. Cards without a
// suggested category cluster by their queue-doc section ref (the 3.2 echo family, the
// 5.2 Erewhon family, …) so policy clusters are also walked as a block.
// AUTHORED candidates get their own clusters (prefixed label) so the operator always
// knows they're ratifying an authored claim+label pair, not a field capture.
export function sittingCluster(entry) {
  const base = entry.suggestedCategory
    ? (entry.suggestedVerdict
        ? `${entry.suggestedCategory} · ${entry.suggestedVerdict}`
        : entry.suggestedCategory)
    : (entry.hintRef ? `§${entry.hintRef}` : "unassigned");
  return entry.authored ? `AUTHORED · ${base}` : base;
}

const CATEGORY_ORDER = new Map(CATEGORIES.map((c, i) => [c.name, i]));
const VERDICT_ORDER = new Map(VERDICTS.map((v, i) => [v.value, i]));

// Sitting order: category-suggested cards first, grouped in CATEGORIES order, then by
// suggested verdict, most-repeated first — so batch-accept eats each cluster in one
// keystroke. Unsuggested cards follow, grouped by queue-doc section ref (policy
// clusters stay together), then by repeat count. Pure sort; never drops/merges cards.
export function orderForSitting(entries) {
  return [...entries].sort((a, b) => {
    const ac = a.suggestedCategory ? CATEGORY_ORDER.get(a.suggestedCategory) : 99;
    const bc = b.suggestedCategory ? CATEGORY_ORDER.get(b.suggestedCategory) : 99;
    if (ac !== bc) return ac - bc;
    // Field cards first, AUTHORED candidates as their own trailing block per category —
    // keeps the AUTHORED-prefixed clusters contiguous instead of interleaving them into
    // same-suggestion field runs (which would split both clusters).
    const aa = a.authored ? 1 : 0, ba = b.authored ? 1 : 0;
    if (aa !== ba) return aa - ba;
    const ar = a.hintRef || "￿", br = b.hintRef || "￿"; // no-ref cards last
    if (!a.suggestedCategory && ar !== br) return ar < br ? -1 : 1;
    const av = a.suggestedVerdict ? VERDICT_ORDER.get(a.suggestedVerdict) : 99;
    const bv = b.suggestedVerdict ? VERDICT_ORDER.get(b.suggestedVerdict) : 99;
    if (av !== bv) return av - bv;
    return b.repeatCount - a.repeatCount || String(a.claim).localeCompare(String(b.claim));
  });
}

// Per-category golden-set gap: how many adjudicated cards each category still needs to
// reach the n>=30 target. `counts` maps category name -> current golden line count.
export function categoryNeeds(counts, target = 30) {
  return CATEGORIES.map((c) => {
    const current = counts[c.name] ?? 0;
    return { category: c.name, current, target, needed: Math.max(0, target - current) };
  });
}

// Next sequential id for a category, given the ids already present in its golden file.
// Matches the existing convention: "<prefix>-NNN" zero-padded to 3 (person-021, …).
export function nextId(prefix, existingIds) {
  let max = 0;
  const re = new RegExp("^" + prefix + "-(\\d+)$");
  for (const id of existingIds || []) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

// Turn one cockpit decision into a golden JSONL entry. `decision` carries the human's
// verdict/category/extraction/note; `queueEntry` carries the deduped claim + provenance;
// `id` is the freshly-allocated sequential id. Mirrors the golden schema exactly
// (id, transcript_snippet, expected_extraction, category, ground_truth_verdict,
// adjudication_note, source_of_truth). Verdict null ⇒ extraction is forced null too
// (schema rule: no verdict without a claim), matching the echo-draft handling in §3.2.
export function buildGoldenEntry(decision, queueEntry, id) {
  const verdict = decision.verdict ?? null;
  let extraction = decision.extraction !== undefined ? decision.extraction : queueEntry.canonical;
  if (verdict === null) extraction = null; // null verdict ⇒ null extraction (echo/opinion)
  const provenance = queueEntry.authored
    ? ` [ratified from AUTHORED candidate ${queueEntry.sourceDrafts.join(", ")}]`
    : queueEntry.repeatCount > 1
      ? ` [graduated from ${queueEntry.repeatCount} field drafts: ${queueEntry.sourceDrafts.join(", ")}]`
      : ` [graduated from field draft ${queueEntry.sourceDrafts[0]}]`;
  const out = {
    id,
    transcript_snippet: queueEntry.sampleTranscript || "",
    expected_extraction: extraction,
    category: decision.category,
    ground_truth_verdict: verdict,
    adjudication_note: (decision.note || "").trim() + provenance,
    source_of_truth: decision.source_of_truth || "",
  };
  // expected_polarity travels with the card (polarity traps + denial-phrased quote
  // cards). The operator ratifies it as part of the claim — run.js/report.js read it for
  // the aired-verdict slice, so dropping it here would silently degrade graduated traps.
  if (queueEntry.expected_polarity) out.expected_polarity = queueEntry.expected_polarity;
  return out;
}

// ── Polarity micro-pass (the 31 negation-ambiguous rows Task 0 left UNSET) ─────────────
//
// A polarity card RULES ON AN EXISTING golden row (it never appends): the operator picks
// one of three rulings and apply.js writes the row's expected_polarity field back in
// place. `ambiguous-drop` writes an EXPLICIT `expected_polarity: null` (+ polarity_note)
// so a ruled-out row is distinguishable from a never-visited one — run.js skips both
// identically (its check is `!= null`), so the drop is behavior-preserving by design.
export const POLARITY_RULINGS = [
  { key: "1", value: "asserts" },
  { key: "2", value: "denies" },
  { key: "3", value: "ambiguous-drop" },
];
export function isPolarityRuling(v) {
  return POLARITY_RULINGS.some((r) => r.value === v);
}

// Join the transcription-only cards (polarity-cards.json) against the LIVE golden rows
// (goldenById: id -> parsed golden row) into cockpit queue entries. The utterance and
// canonical claim always come from the golden file — the cards never duplicate them, so
// they cannot drift. Cards whose row now HAS the expected_polarity key (even explicit
// null — i.e. already ruled, including ambiguous-drop) fall out of the queue, which makes
// prep.js naturally idempotent after an apply. Card order is preserved (it IS the sitting
// order); families become "polarity · <family>" cluster labels, contiguous by authorship.
export function buildPolarityEntries(cards, goldenById) {
  const entries = [];
  const alreadyRuled = [];
  const missing = [];
  for (const card of cards || []) {
    const row = goldenById.get(card.id);
    if (!row) { missing.push(card.id); continue; }
    if (Object.hasOwn(row, "expected_polarity")) { alreadyRuled.push(card.id); continue; }
    entries.push({
      key: "pol::" + card.id,
      mode: "polarity",
      goldenId: card.id,
      category: row.category,
      claim: row.expected_extraction,          // may be null (the null-claim filler family)
      canonical: row.expected_extraction,
      groundTruth: row.ground_truth_verdict,
      sampleTranscript: row.transcript_snippet || "",
      readings: card.readings || [],
      ambiguity: card.ambiguity || "",
      repeatCount: 1,
      sourceDrafts: [card.id],
      suggestedCategory: null,                 // NEVER suggested — the queue docs carry no
      suggestedVerdict: null,                  // answers for these rows (hints are for 3-5)
      cluster: "polarity · " + (card.family || "micro-pass"),
    });
  }
  return { entries, alreadyRuled, missing };
}

// Write one polarity ruling into one raw golden JSONL line, surgically: every other byte
// of the line is preserved (matching the files' hand-spaced style), and the field is
// appended before the closing brace exactly like the 229 already-labeled rows. Pure —
// returns { changed, line, reason }. Refuses to clobber: a line that already carries the
// expected_polarity key comes back unchanged (that's also apply's idempotency).
export function applyPolarityToLine(line, ruling, note) {
  const row = JSON.parse(line);
  if (Object.hasOwn(row, "expected_polarity")) return { changed: false, line, reason: "already ruled" };
  if (!isPolarityRuling(ruling)) return { changed: false, line, reason: `unknown ruling ${JSON.stringify(ruling)}` };
  const close = line.lastIndexOf("}");
  if (close < 0) return { changed: false, line, reason: "malformed line" };
  let insert;
  if (ruling === "ambiguous-drop") {
    const polNote = "negation-ambiguous — excluded from the polarity slice by operator ruling (micro-pass)" +
      (note && note.trim() ? ": " + note.trim() : "");
    insert = `, "expected_polarity": null, "polarity_note": ${JSON.stringify(polNote)}`;
  } else {
    insert = `, "expected_polarity": ${JSON.stringify(ruling)}`;
    if (note && note.trim()) insert += `, "polarity_note": ${JSON.stringify(note.trim())}`;
  }
  return { changed: true, line: line.slice(0, close) + insert + line.slice(close), reason: null };
}

// Idempotency guard for apply.js: has this claim already been graduated into the target
// golden file? Compares normalized claim text (an id can't collide — apply allocates a
// fresh one — but re-running apply on the same graduations.json must not double-append).
export function alreadyGraduated(entry, existingEntries) {
  const target = entry.expected_extraction ? normalizeClaim(entry.expected_extraction) : null;
  for (const ex of existingEntries) {
    if (ex.id === entry.id) return true;
    if (target && ex.expected_extraction && normalizeClaim(ex.expected_extraction) === target &&
        ex.category === entry.category) return true;
  }
  return false;
}
