// Shared error type for adapter → route error handling. Adapters throw UpstreamError when
// the vendor API answered but unhappily (non-2xx); plain Errors mean everything else
// (network failure, parse failure). Routes branch on instanceof to keep response bodies
// byte-identical to the pre-adapter code: UpstreamError carries the upstream status +
// truncated detail the routes surface as { upstream_status, upstream }.
//   message — client-safe short label (may be echoed in a response body)
//   status  — upstream HTTP status (number) or null
//   detail  — truncated upstream response text (already sliced by the adapter)
//   meta    — extra client-safe fields a route may spread into its error body (e.g. dg_ms)
export class UpstreamError extends Error {
  constructor(message, { status = null, detail = "", meta = {} } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.detail = detail;
    this.meta = meta;
  }
}
