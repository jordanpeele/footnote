export declare const ROUTE_CLASSES: {
    extract: string;
    verify: string;
    transcribe: string;
    "dg-token": string;
    onair: string;
    admin: string;
};
export declare const localKill: {
    engaged: boolean;
    at: null;
};
/** TEST HOOK ONLY — replace the flag reader; pass null/undefined to restore the default. */
export declare function _setFlagReader(fn: any): void;
/**
 * Pure gate policy: flag value in, decision out. Split from spendGate so the 503
 * contract is unit-testable without mocking req/res or the store.
 * @param {boolean} flagValue
 * @returns {{allow: true} | {allow: false, status: 503, body: {error: string, paused: true}}}
 */
export declare function gateDecision(flagValue: boolean): {
    allow: true;
} | {
    allow: false;
    status: 503;
    body: {
        error: string;
        paused: true;
    };
};
/**
 * Call FIRST in every costed/gated route (before rate limiting — a killed deployment
 * shouldn't burn store writes either). Responds 503 and returns false while the operator
 * kill flag is set; returns true otherwise. Fails OPEN on any store trouble.
 * @returns {Promise<boolean>} true = proceed, false = response already sent
 */
export declare function spendGate(req: any, res: any): Promise<boolean>;
