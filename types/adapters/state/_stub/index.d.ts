export declare const name = "stub";
export declare function isConfigured(): boolean;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["publish"]} */
export declare function publish(room: string, event: import("../../../core/interfaces/state-channel.js").RoomEvent, _opts?: {}): Promise<void>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["get"]} */
export declare function get(room: string): Promise<import("../../../core/interfaces/state-channel.js").RoomEvent | null>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["registerRoom"]} */
export declare function registerRoom(room: string, writeKey: string, _opts?: {}): Promise<boolean>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["appendLog"]} */
export declare function appendLog(room: string, entry: Object): Promise<void>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["readLog"]} */
export declare function readLog(room: string): Promise<Object[]>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["subscribe"]} */
export declare function subscribe(room: any, handler: any): () => any;
