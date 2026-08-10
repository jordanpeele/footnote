// Footnote editorial policy (Decision D5): source-trust ranking and verdict/evidence rules
// live HERE, in core — above the Verifier interface — so no vendor adapter can weaken them.
// A Verifier returns a raw verdict + raw citations; this module ranks the citations by
// trust tier, selects the single surfaced source, normalizes the verdict, and cleans the
// correction for on-air display. Swapping Perplexity for another verifier does not change
// what Footnote is willing to put on television.

export const VERDICTS = ["True", "False", "Misleading", "Unverifiable", "NeedsContext"];

// Tier-3: the sources an average American treats as authoritative (wires, national news,
// official data, encyclopedias, established fact-checkers). Any *.gov/*.mil/*.edu is tier-3 too.
export const HIGH_TRUST = new Set([
  "reuters.com", "apnews.com", "ap.org", "bbc.com", "bbc.co.uk", "npr.org", "pbs.org",
  "nytimes.com", "washingtonpost.com", "wsj.com", "bloomberg.com", "economist.com",
  "theguardian.com", "cnn.com", "nbcnews.com", "abcnews.go.com", "cbsnews.com", "usatoday.com",
  "politico.com", "axios.com", "forbes.com", "time.com", "theatlantic.com", "latimes.com",
  "britannica.com", "nature.com", "science.org", "scientificamerican.com", "nationalgeographic.com",
  "pewresearch.org", "snopes.com", "factcheck.org", "politifact.com",
  "who.int", "un.org", "worldbank.org", "imf.org", "oecd.org", "europa.eu",
]);
// Tier-2: reputable, mainstream-recognized, but a notch below the wire/gov tier.
export const MID_TRUST = new Set([
  "investopedia.com", "history.com", "healthline.com", "mayoclinic.org", "webmd.com",
  "cnbc.com", "businessinsider.com", "vox.com", "thehill.com", "newsweek.com", "usnews.com",
  "wikipedia.org", "census.gov", "bls.gov",
]);
// Never surface these as the source (social, forums, personal blogs, SEO/commerce).
export const LOW_TRUST_RE = /(^|\.)(reddit|quora|x|twitter|facebook|instagram|tiktok|youtube|pinterest|medium|wikihow|answers|ask|blogspot|wordpress|substack|tumblr)\.com$/i;
// URL shorteners evade the .com-anchored blocklist (t.co, youtu.be were tier-1 and could
// surface as the on-air source — red-team L3). The destination is unknowable from the
// host, so they can never be the surfaced source.
export const SHORTENER_RE = /(^|\.)(t\.co|bit\.ly|youtu\.be|tinyurl\.com|goo\.gl|ow\.ly|buff\.ly)$/i;

// human-readable outlet name for the domains we surface, so the displayed source always
// matches the URL we link (a fact-checker must never show a name that isn't the cited page).
export const PRETTY = {
  "reuters.com": "Reuters", "apnews.com": "Associated Press", "ap.org": "Associated Press",
  "bbc.com": "BBC", "bbc.co.uk": "BBC", "npr.org": "NPR", "pbs.org": "PBS",
  "nytimes.com": "The New York Times", "washingtonpost.com": "The Washington Post", "wsj.com": "The Wall Street Journal",
  "bloomberg.com": "Bloomberg", "economist.com": "The Economist", "theguardian.com": "The Guardian",
  "cnn.com": "CNN", "nbcnews.com": "NBC News", "abcnews.go.com": "ABC News", "cbsnews.com": "CBS News",
  "usatoday.com": "USA Today", "politico.com": "Politico", "axios.com": "Axios", "forbes.com": "Forbes",
  "time.com": "TIME", "theatlantic.com": "The Atlantic", "latimes.com": "Los Angeles Times",
  "britannica.com": "Encyclopædia Britannica", "nature.com": "Nature", "science.org": "Science",
  "scientificamerican.com": "Scientific American", "nationalgeographic.com": "National Geographic",
  "pewresearch.org": "Pew Research Center", "snopes.com": "Snopes", "factcheck.org": "FactCheck.org",
  "politifact.com": "PolitiFact", "who.int": "World Health Organization", "un.org": "United Nations",
  "worldbank.org": "World Bank", "imf.org": "IMF", "oecd.org": "OECD",
  "investopedia.com": "Investopedia", "history.com": "History.com", "cnbc.com": "CNBC",
  "wikipedia.org": "Wikipedia", "census.gov": "U.S. Census Bureau", "bls.gov": "Bureau of Labor Statistics",
  "cdc.gov": "CDC", "nasa.gov": "NASA", "noaa.gov": "NOAA", "federalreserve.gov": "Federal Reserve",
  "congress.gov": "U.S. Congress", "usa.gov": "USA.gov", "cftc.gov": "CFTC", "sec.gov": "SEC",
  "bea.gov": "Bureau of Economic Analysis", "bjs.ojp.gov": "Bureau of Justice Statistics", "fbi.gov": "FBI",
  // P5F-3 pass: hosts seen in field logs / goldens whose derived name read as junk
  // ("archives.gov" → "ARCHIVES") plus the rest of the commonly-cited official set.
  "archives.gov": "National Archives", "loc.gov": "Library of Congress",
  "ssa.gov": "Social Security Administration", "cbo.gov": "Congressional Budget Office",
  "state.gov": "U.S. State Department", "treasury.gov": "U.S. Treasury",
  "justice.gov": "U.S. Justice Department", "whitehouse.gov": "The White House",
  "nih.gov": "National Institutes of Health", "weather.gov": "National Weather Service",
  "eia.gov": "U.S. Energy Information Administration", "supremecourt.gov": "U.S. Supreme Court",
  "stlouisfed.org": "Federal Reserve Bank of St. Louis", "europa.eu": "European Union",
  "mayoclinic.org": "Mayo Clinic", "webmd.com": "WebMD", "healthline.com": "Healthline",
  "businessinsider.com": "Business Insider", "vox.com": "Vox", "thehill.com": "The Hill",
  "newsweek.com": "Newsweek", "usnews.com": "U.S. News & World Report",
};

// Verifiers return markdown (**bold**, *italic*, `code`, [links](url)) and [1] citation
// markers in the correction text. Strip it all — the chyron renders as plain text on air.
export function cleanText(s) {
  let out = String(s || "");
  // Markdown nests (**bold *ital***, ***both***) and a single pass can leave literal
  // markers on the chyron (red-team L5) — iterate the strip passes to a fixpoint,
  // bounded so pathological input can't spin.
  for (let i = 0; i < 6; i++) {
    const prev = out;
    out = out
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")   // [text](url) → text
      .replace(/\*\*([^*]+)\*\*/g, "$1")               // **bold**
      .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")    // *italic*
      .replace(/__([^_]+)__/g, "$1")                     // __bold__
      .replace(/`([^`]+)`/g, "$1")                       // `code`
      .replace(/\[\d+\]/g, "");                           // [1][2] citation markers
    if (out === prev) break;
  }
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")                    // tidy space left before punctuation
    .trim();
}
// On-air truncation must not split a surrogate pair — a blind .slice can leave a lone
// high surrogate that renders as � on the chyron (red-team L4).
export function truncateOnAir(s, n) {
  const t = String(s || "").slice(0, n);
  return t.replace(/[\uD800-\uDBFF]$/, "");
}
export function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; } }
/* Display-name derivation (P5F-3). Order of authority:
   1. Curated PRETTY map — exact host, then parent suffixes, so deep hosts inherit the
      curated name (data.census.gov → "U.S. Census Bureau", en.wikipedia.org → "Wikipedia").
   2. Two-label .gov/.mil with a short (≤4 char) label reads as an agency acronym
      (va.gov → "VA", hud.gov → "HUD"). Longer labels are NEVER upper-cased — the
      "ARCHIVES" field bug (archives.gov) was this path shouting a whole word.
   3. Simple registrable domain → title-cased label ("brookings.edu" → "Brookings").
   4. UNKNOWN deep host → cleaned host: the last ≤3 labels, leading capital, never
      all-caps, never path junk ("webspace.science.uu.nl" → "Science.uu.nl"). */
export function prettyName(host) {
  if (!host) return "source";
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {           // exact host first, then parent suffixes
    const hit = PRETTY[labels.slice(i).join(".")];
    if (hit) return hit;
  }
  const label = labels.length >= 2 ? labels[labels.length - 2] : host;
  if (labels.length === 2 && /\.(gov|mil)$/.test(host) && label.length <= 4) return label.toUpperCase();
  if (labels.length <= 2) {
    const name = label.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    // "Source: T" (t.co) / "Source: Ao" is a credibility bug (red-team L3) — a derived
    // name under 3 chars carries no meaning, so show the full host instead.
    return name.length < 3 ? host : name;
  }
  const cleaned = labels.slice(-3).join(".");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
const GOV_CC = ["gov.uk", "gov.au", "gov.ca", "gc.ca", "gov.in", "gov.br", "gov.za", "gov.sg",
  "gov.il", "gov.ie", "gov.nz", "govt.nz", "gov.jp", "go.jp", "gov.kr", "go.kr", "gov.it",
  "gouv.fr", "bund.de", "gov.pl", "europa.eu"];

export function trustTier(host) {
  if (!host) return 0;
  // Exact .gov/.mil TLDs plus a CURATED list of national-government domains. A generic
  // `.gov.<cc>` pattern is an attack surface: gov.io-style second-levels are privately
  // registrable and would inherit tier-3 trust (red-team H3).
  if (/\.(gov|mil)$/.test(host) || GOV_CC.some((s) => host === s || host.endsWith("." + s))) return 3;
  if (HIGH_TRUST.has(host)) return 3;
  if (MID_TRUST.has(host)) return 2;
  if (LOW_TRUST_RE.test(host) || SHORTENER_RE.test(host)) return 0;
  return 1; // generic .edu, org, or unknown-but-not-blocklisted — only surfaced if nothing better
}

// rank every citation by trust tier (stable within tier), drop blocklisted ones entirely
export function rankCitations(urls) {
  const ranked = (Array.isArray(urls) ? urls : [])   // adapter-proof: vendor may return non-array (red-team L1)
    .map((u) => ({ url: u, host: hostOf(u), tier: trustTier(hostOf(u)) }))
    .filter((c) => c.host && c.tier > 0);
  ranked.sort((a, b) => b.tier - a.tier);
  return ranked;
}

// Auto-air evidence floor (HOW_FOOTNOTE_DECIDES.md: definitive verdicts need "T1–T2
// sourcing, or two independent T3 sources"). Mapped onto the code's coarser 0–3 tiers:
// code tier 3 merges policy T1/T2/most-of-T3, so "surfaced source is tier 3" stands in
// for the T1–T2 floor, and "≥2 tier≥2 citations from distinct hostnames" stands in for
// two independent T3s. Closes the tier-blind gate: a lone tier-1/unknown source can no
// longer satisfy auto-air, no matter the confidence.
export function autoAirEligible(ranked) {
  const best = ranked[0] || null;
  if (best && best.tier === 3) return true;
  const hosts = new Set(ranked.filter((c) => c.tier >= 2).map((c) => c.host));
  return hosts.size >= 2;
}

/**
 * Apply the full editorial policy to a raw verifier result and produce the on-air card body.
 * @param {import("./interfaces/verifier.js").RawVerification} rv
 * @returns {{verdict: string, correction: string, confidence: number, source: {name: string, url: string|null, tier: number}, citations: string[], autoAirEligible: boolean}}
 */
export function finalizeVerification(rv) {
  const ranked = rankCitations(rv.citations);
  const best = ranked[0] || null;
  // display name is derived from the chosen domain so it ALWAYS matches the linked URL
  const sourceName = best ? prettyName(best.host) : ((rv.sourceName || "").trim() || "source");
  // Verdict normalization is case-insensitive (red-team L7): a vendor returning "false"
  // or " True" is a correct definitive verdict, not an Unverifiable — silently softening
  // it would both mis-air the card and wrongly exclude it from auto-air.
  const rawVerdict = typeof rv.verdict === "string" ? rv.verdict.trim().toLowerCase() : "";
  return {
    verdict: VERDICTS.find((v) => v.toLowerCase() === rawVerdict) || "Unverifiable",
    correction: truncateOnAir(cleanText(rv.correction || rv.raw || ""), 240),
    confidence: typeof rv.confidence === "number" ? Math.max(0, Math.min(1, rv.confidence)) : 0.5,
    source: { name: sourceName, url: best ? best.url : null, tier: best ? best.tier : 0 },
    citations: ranked.slice(0, 5).map((c) => c.url),
    autoAirEligible: autoAirEligible(ranked),
  };
}
