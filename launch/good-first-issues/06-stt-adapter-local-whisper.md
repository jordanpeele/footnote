# STT adapter: local Whisper server (fully-local dev)

**Labels:** good first issue, adapter, stt

## Context

Today you can't hear Footnote without a Deepgram key. A local Whisper adapter (pointing at any OpenAI-compatible local server — whisper.cpp's `server`, faster-whisper-server, Speaches) makes the transcription leg free and offline: contributors can develop the full pipeline UI, skins, and queue behavior with zero STT spend, and privacy-sensitive self-hosters keep audio on-box.

Latency will be worse than Deepgram streaming — that's fine. This is a dev/self-host adapter, not a broadcast recommendation; be honest about the tradeoff in its README.

## Pointers

- Interface contract: `src/core/interfaces/stt.js` <!-- landing in sprint-01: until the layout lands, the two reference paths are the browser-direct Deepgram streaming WS in `app.js` (token-minted via `api/dg-token.js`) and the chunked-upload fallback in `api/transcribe.js` -->
- Reference adapter: `src/adapters/stt/deepgram/`
- The contract's key semantic: emit **interim** and **final** sentence events — *finals* are what trigger claim extraction (see the pipeline wiring in `app.js`). The chunked `api/transcribe.js` path is the closer shape to copy for an HTTP Whisper server.
- Candidate servers: whisper.cpp server, faster-whisper-server, Speaches — pick one, document it, keep the adapter generic over the OpenAI `/v1/audio/transcriptions` shape where possible.

## Definition of done

- [ ] `src/adapters/stt/local-whisper/` implementing the STT interface: audio in → interim/final events out, with sentence-final segmentation good enough to feed extraction
- [ ] Configurable server URL via env (documented in `.env.example`); no API key required; zero new runtime deps
- [ ] Adapter README: which server it was tested against, exact launch command, measured latency vs Deepgram, and the "dev/self-host, not broadcast" caveat
- [ ] Demonstrated end-to-end: speak → claim extracted → card in the queue, with no Deepgram key set (short recording or GIF in the PR)
- [ ] Graceful failure when the local server is down (clear UI error, no silent hang)
