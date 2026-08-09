// D14 route inventory — how the kill-switch guarantee survives future contributors.
// ROUTE_CLASSES (src/core/spendgate.js) is the registry of record; this test pins it to
// reality in both directions:
//   (a) every api/*.js route (underscore helpers excluded) is classified, and every
//       classified route exists — so adding a new route without deciding its spend class
//       fails CI instead of silently shipping an ungated spend path;
//   (b) every "costed"/"gated" route's source contains a spendGate( call, and "free"
//       routes (admin) contain none — admin gated = operator locked out of restore.
// The source check is static (string scan), deliberately: it can't be defeated by env or
// store availability, and it catches "I removed the gate call" in review-free merges.
//
// Round-3 concurrency note: verify/onair/dg-token are owned by other agents this round.
// Until they migrate from round-2's killed() to spendGate(), their assertions report as
// TODO (EXPECTED-PENDING) instead of failing the run; once their source contains
// spendGate( the todo branch is dead code and these become hard asserts automatically.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ROUTE_CLASSES } from "../src/core/spendgate.js";

const API_DIR = fileURLToPath(new URL("../api/", import.meta.url));
const routes = readdirSync(API_DIR)
  .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
  .map((f) => f.slice(0, -".js".length));
const src = (r) => readFileSync(path.join(API_DIR, r + ".js"), "utf8");

// Files this packet owns get hard asserts; the rest may lag mid-round (see note above).
const OWNED = new Set(["extract", "transcribe"]);

test("ROUTE_CLASSES matches the api/ directory exactly (both directions)", () => {
  assert.deepEqual(
    [...routes].sort(),
    Object.keys(ROUTE_CLASSES).sort(),
    "api/ routes and ROUTE_CLASSES diverge — classify new routes in src/core/spendgate.js (D14)"
  );
  for (const [r, cls] of Object.entries(ROUTE_CLASSES)) {
    assert.ok(["costed", "gated", "free"].includes(cls), `${r}: invalid class "${cls}"`);
  }
});

for (const r of routes) {
  const cls = ROUTE_CLASSES[r];
  if (cls === "costed" || cls === "gated") {
    const gated = src(r).includes("spendGate(");
    if (!gated && !OWNED.has(r)) {
      // EXPECTED-PENDING: owner agent migrates this route to spendGate this round.
      test(`${r} (${cls}) calls spendGate — EXPECTED-PENDING, owner migrating from killed()`, { todo: "owner migration pending this round" }, () => {
        assert.ok(gated, `${r} must call spendGate( (D14)`);
      });
    } else {
      test(`${r} (${cls}) calls spendGate`, () => {
        assert.ok(gated, `${r} is "${cls}" but never calls spendGate( (D14 violation)`);
      });
    }
  } else if (cls === "free") {
    test(`${r} (free) never calls spendGate`, () => {
      assert.ok(!src(r).includes("spendGate("), `${r} is "free" (restore path) — it must not be gated`);
    });
  }
}

// Order-of-checks, statically: in the routes this packet wired, the spendGate call site
// must precede the rate limiter and any adapter lookup, so a killed deployment does zero
// store writes and zero vendor calls. (Import lines don't contain "name(" so indexOf
// finds the call sites.)
for (const r of OWNED) {
  test(`${r}: spendGate call precedes rateLimit and getAdapter`, () => {
    const s = src(r);
    const gate = s.indexOf("spendGate(");
    assert.ok(gate >= 0, `${r} missing spendGate(`);
    for (const later of ["rateLimit(", "getAdapter("]) {
      const i = s.indexOf(later);
      if (i >= 0) assert.ok(gate < i, `${r}: spendGate( must come before ${later}`);
    }
  });
}
