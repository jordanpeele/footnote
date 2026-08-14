export declare const name = "stub";
export declare function isConfigured(): boolean;
/** @type {import("../../../core/interfaces/stt-provider.js").STTProvider["transcribe"]} */
export declare function transcribe(audio: Buffer, _audioType: string): Promise<import("../../../core/interfaces/stt-provider.js").TranscribeResult>;
/** @type {NonNullable<import("../../../core/interfaces/stt-provider.js").STTProvider["mintToken"]>} */
export declare function mintToken(_credentials?: import("../../../core/interfaces/stt-provider.js").STTCredentials | null | undefined): Promise<{
    accessToken: string;
    expiresIn: number;
}>;
