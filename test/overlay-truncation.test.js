// A-8 (Sprint-A): render-truncation telemetry. overlay.js clamps the claim/correction lines
// with -webkit-line-clamp; when the text overflows, the reader loses the tail (possibly
// mid-figure on the most-read line). overlay.js detects this from geometry and logs
// ev:"truncated" {field, len} through the existing hostname-gated ftLog sink (field-test/
// local only — no new network on prod).
//
// overlay.js is a browser IIFE loaded as a classic <script>, so it can't be imported into a
// Node process without a DOM. The overflow decision, however, is a PURE function of two
// numbers (scrollHeight, clientHeight): `isTruncated = (s, c) => s - c > 1`. This test pins
// that predicate's boundary behavior. It is MIRRORED from overlay.js by design — if the
// cushion or comparison there changes, this mirror must change with it (both carry the same
// rationale comment). The DOM wiring (which nodes, when it runs) is documented as DOM-only.
import test from "node:test";
import assert from "node:assert/strict";

// MIRROR of overlay.js's isTruncated — keep byte-identical to the source predicate.
const isTruncated = (scrollH, clientH) => scrollH - clientH > 1;

test("clear overflow (scrollHeight well above clientHeight) → truncated", () => {
  assert.equal(isTruncated(120, 72), true);
});

test("exact fit (scrollHeight === clientHeight) → not truncated", () => {
  assert.equal(isTruncated(72, 72), false);
});

test("sub-pixel rounding cushion: 1px over is NOT counted as truncated (no false positive)", () => {
  assert.equal(isTruncated(73, 72), false, "line-box rounding routinely reports 1px over with nothing cut");
});

test("just past the cushion (>1px over) → truncated", () => {
  assert.equal(isTruncated(74, 72), true);
});

test("content shorter than the box (rare, defensive) → not truncated", () => {
  assert.equal(isTruncated(40, 72), false);
});
