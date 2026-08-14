export declare class UpstreamError extends Error {
    status: any;
    detail: string;
    meta: {};
    constructor(message: any, { status, detail, meta }?: {
        detail?: string | undefined;
        meta?: {} | undefined;
        status?: null | undefined;
    });
}
