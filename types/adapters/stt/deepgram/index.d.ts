export declare const name = "deepgram";
export declare function isConfigured(): boolean;
/** @type {import("../../../core/interfaces/stt-provider.js").STTProvider["transcribe"]} */
export declare function transcribe(audio: Buffer, audioType: string): Promise<import("../../../core/interfaces/stt-provider.js").TranscribeResult>;
/** @type {NonNullable<import("../../../core/interfaces/stt-provider.js").STTProvider["mintToken"]>} */
export declare function mintToken(credentials?: import("../../../core/interfaces/stt-provider.js").STTCredentials | null | undefined): Promise<{
    accessToken: string;
    expiresIn: number;
}>;
