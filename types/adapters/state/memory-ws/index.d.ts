export declare const name = "memory";
export declare function isConfigured(): boolean;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["publish"]} */
export declare function publish(room: string, event: import("../../../core/interfaces/state-channel.js").RoomEvent, { ttlSec }?: {
    ttlSec?: number;
} | undefined): Promise<void>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["get"]} */
export declare function get(room: string): Promise<import("../../../core/interfaces/state-channel.js").RoomEvent | null>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["merge"]} */
export declare function merge(room: any, fields: any, { ttlSec }?: {}): Promise<void>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["registerRoom"]} */
export declare function registerRoom(room: string, writeKey: string, { ttlSec }?: {
    ttlSec?: number;
} | undefined): Promise<boolean>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["appendLog"]} */
export declare function appendLog(room: string, entry: Object): Promise<void>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["readLog"]} */
export declare function readLog(room: string): Promise<Object[]>;
/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["subscribe"]} */
export declare function subscribe(room: any, handler: any): () => void;
