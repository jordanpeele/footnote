#!/usr/bin/env python3
"""Stub consumer for the relay audio tap (DAYSPRINT 2a — Phase-2 keystone, dark).

audio-tap.service emits pcm16 mono 16 kHz as s16le datagrams to udp://127.0.0.1:9877,
640 bytes = 20 ms per packet. This stub stands where the Deepgram websocket bridge
will stand (see docs/PHASE2_DESIGN.md — the bridge consumes this exact byte stream,
minting its token via the /api/dg-token contract) and prints a once-per-second line:

    t=12s pkts=50 bytes=32000 audio_ms=1000.0 (cum 384000 B / 12.0 s)

Run it on the relay while tap mode is up:  python3 tap-stub-listen.py [port]
Stdlib only — nothing to install on the nano.
"""
import socket, sys, time

port = int(sys.argv[1]) if len(sys.argv) > 1 else 9877
BYTES_PER_MS = 16000 * 2 / 1000  # pcm16 mono 16 kHz

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("127.0.0.1", port))
s.settimeout(1.0)
print(f"listening on udp://127.0.0.1:{port} (pcm16 mono 16k, 640 B = 20 ms)", flush=True)

t0 = None
cum_bytes = 0
win_bytes = 0
win_pkts = 0
last = time.monotonic()
while True:
    try:
        data = s.recv(2048)
        if t0 is None:
            t0 = time.monotonic()
            print("first packet", flush=True)
        cum_bytes += len(data)
        win_bytes += len(data)
        win_pkts += 1
    except socket.timeout:
        pass
    now = time.monotonic()
    if now - last >= 1.0 and t0 is not None:
        t = now - t0
        print(f"t={t:.0f}s pkts={win_pkts} bytes={win_bytes} "
              f"audio_ms={win_bytes / BYTES_PER_MS:.1f} "
              f"(cum {cum_bytes} B / {cum_bytes / BYTES_PER_MS / 1000:.1f} s)", flush=True)
        win_bytes = win_pkts = 0
        last = now
