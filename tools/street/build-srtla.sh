#!/bin/bash
# Build srtla_rec + srtla_send (BELABOX/srtla) on macOS/ARM for the street rig.
# P7-D (R45): SRTLA bonded uplink receiver — Moblin sends srtla:// over multiple
# network paths; srtla_rec reassembles and hands plain SRT to the OBS listener.
#
# Upstream is Linux-only. This applies tools/street/srtla-macos.patch:
#   - endian.h byte-order macros -> libkern/OSByteOrder.h shims
#   - SOCK_NONBLOCK -> fcntl(O_NONBLOCK) fallback
#   - CLOCK_MONOTONIC_COARSE -> CLOCK_MONOTONIC
#   - epoll -> epoll-shim (kqueue-backed, brew install epoll-shim)
#
# Vendor tree lives OUTSIDE the repo (~/Code/vendor/srtla) so no build
# artifacts land in git. Re-run any time; it re-clones only if missing.
set -e
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VENDOR_DIR="$HOME/Code/vendor/srtla"
PATCH="$REPO_DIR/tools/street/srtla-macos.patch"
EPOLL_PREFIX="$(brew --prefix epoll-shim 2>/dev/null || echo /opt/homebrew/opt/epoll-shim)"

echo "— deps (brew):"
brew list --versions srt >/dev/null 2>&1 || brew install srt
brew list --versions epoll-shim >/dev/null 2>&1 || brew install epoll-shim
brew list --versions srt epoll-shim | sed 's/^/  /'

if [ ! -d "$VENDOR_DIR/.git" ]; then
  mkdir -p "$(dirname "$VENDOR_DIR")"
  git clone https://github.com/BELABOX/srtla "$VENDOR_DIR"
  git -C "$VENDOR_DIR" checkout 37862da3d0c13b46956efd3f88877053293d97d6   # pinned: the commit srtla-macos.patch was built + audited against
fi
cd "$VENDOR_DIR"

# Apply the macOS patch if not already applied (idempotent check on the shim header).
if [ ! -f macos_compat.h ]; then
  git apply "$PATCH"
  echo "  applied srtla-macos.patch"
else
  echo "  srtla-macos.patch already applied"
fi

make clean >/dev/null 2>&1 || true
make \
  CFLAGS="-g -O2 -Wall -DVERSION=\\\"$(git rev-parse --short HEAD)-macos\\\" -I$EPOLL_PREFIX/include/libepoll-shim" \
  LDFLAGS="-L$EPOLL_PREFIX/lib" \
  LDLIBS="-lepoll-shim"

echo
echo "— built:"
file srtla_rec srtla_send | sed 's/^/  /'
echo "  srtla_rec usage: srtla_rec SRTLA_LISTEN_PORT SRT_HOST SRT_PORT"
echo "  street wiring:   $VENDOR_DIR/srtla_rec 5000 127.0.0.1 9000"
