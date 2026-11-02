/// <reference types="node" />
import { WebSocket } from 'ws';
type subLine = {
    part: string;
    start: number;
    end: number;
};
type configure = {
    voice?: string;
    lang?: string;
    outputFormat?: string;
    saveSubtitles?: boolean;
    proxy?: string;
    rate?: string;
    pitch?: string;
    volume?: string;
    timeout?: number;
};
declare class EdgeTTS {
    private voice;
    private lang;
    private outputFormat;
    private saveSubtitles;
    private proxy?;
    private rate;
    private pitch;
    private volume;
    private timeout;
    constructor({ voice, lang, outputFormat, saveSubtitles, proxy, rate, pitch, volume, timeout }?: configure);
    _connectWebSocket(): Promise<WebSocket>;
    _saveSubFile(subFile: subLine[], text: string, audioPath: string): void;
    ttsPromise(text: string, audioPath: string): Promise<unknown>;
    /**
     * Stream audio chunks as they arrive from Edge TTS (for SSE / real-time streaming).
     * Yields binary audio chunks and, when saveSubtitles is enabled, word-boundary
     * subtitles with start/end times in milliseconds until turn.end.
     */
    streamAudio(text: string): AsyncGenerator<Buffer | subLine>;
}
export { EdgeTTS };
