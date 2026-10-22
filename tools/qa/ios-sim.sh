#!/usr/bin/env bash
# Kiln QA (G): iOS Simulator helper for the phone checks (brief G task 4). Uses only Xcode's
# simctl: boots an iPhone simulator, opens the game in Safari, waits, saves screenshots. The
# interactive part (drag, Add to Home Screen, offline relaunch) is done through the iOS Simulator
# MCP tool; this script makes the before/after evidence repeatable.
#
#   tools/qa/ios-sim.sh list                                  iPhones installed on this Mac
#   tools/qa/ios-sim.sh open  [device] [url]                  boot + open url (default http://localhost:8790/?mute=1)
#   tools/qa/ios-sim.sh shot  [device] [name]                 screenshot to tools/qa/out/ios/<name>.png
#   tools/qa/ios-sim.sh check [device] [url]                  open, wait 20 s (KILN_IOS_WAIT), screenshot
#   tools/qa/ios-sim.sh appearance [device] dark|light
#   tools/qa/ios-sim.sh mem [seconds]                         every 2 s for N s (default 1 sample): the
#                                                             simulator's WebKit processes, physical
#                                                             footprint and resident MB, and the peak
#   tools/qa/ios-sim.sh shutdown [device]
# device defaults to the newest "iPhone NN Pro" installed. The simulator reaches the Mac's localhost.
# Every URL must carry mute=1: the simulator plays through the Mac speakers (LEAD 19:25).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/tools/qa/out/ios"
cmd="${1:-help}"; shift || true

default_device() {
  xcrun simctl list devices available | sed -n 's/^ *\(iPhone [0-9][0-9]* Pro\) (\([0-9A-F-]*\)).*/\2 \1/p' | tail -1 | cut -d' ' -f1
}
resolve() {
  local d="${1:-}"
  if [ -z "$d" ]; then d="$(default_device)"; fi
  [ -n "$d" ] || { echo "no iPhone simulator installed (Xcode > Settings > Components)" >&2; exit 1; }
  # a name is resolved to the UDID of the newest runtime that has it
  if ! printf '%s' "$d" | grep -Eq '^[0-9A-F-]{36}$'; then
    local udid
    udid="$(xcrun simctl list devices available | grep -F "    $d (" | tail -1 | sed -n 's/.*(\([0-9A-F-]\{36\}\)).*/\1/p')"
    [ -n "$udid" ] || { echo "no simulator named \"$d\"" >&2; exit 1; }
    d="$udid"
  fi
  printf '%s' "$d"
}
boot() {
  local u="$1"
  if ! xcrun simctl list devices | grep -F "$u" | grep -q Booted; then
    xcrun simctl boot "$u"
  fi
  xcrun simctl bootstatus "$u" -b >/dev/null
}

# Add mute=1 to any game URL that lacks it.
muted() {
  local url="${1:-http://localhost:8790/}"
  case "$url" in
    *mute=1*) printf '%s' "$url" ;;
    *\?*) printf '%s&mute=1' "$url" ;;
    *) printf '%s?mute=1' "$url" ;;
  esac
}

case "$cmd" in
  list) xcrun simctl list devices available | grep -E '^--|iPhone' ;;
  open)
    u="$(resolve "${1:-}")"; boot "$u"; url="$(muted "${2:-}")"
    xcrun simctl openurl "$u" "$url"
    echo "opened $url on $u" ;;
  shot)
    u="$(resolve "${1:-}")"; mkdir -p "$OUT"
    f="$OUT/${2:-shot-$(date +%H%M%S)}.png"
    xcrun simctl io "$u" screenshot "$f" >/dev/null 2>&1
    echo "$f" ;;
  check)
    u="$(resolve "${1:-}")"; boot "$u"; mkdir -p "$OUT"
    xcrun simctl openurl "$u" "$(muted "${2:-}")"
    sleep "${KILN_IOS_WAIT:-20}" # cold Safari + three.js from the CDN; first boot can take 15 s
    f="$OUT/check-$(xcrun simctl list devices | grep -F "$u" | sed 's/^ *//; s/ (.*//; s/ /-/g').png"
    xcrun simctl io "$u" screenshot "$f" >/dev/null 2>&1
    echo "$f" ;;
  appearance)
    u="$(resolve "${1:-}")"; xcrun simctl ui "$u" appearance "${2:-dark}" ;;
  shutdown)
    u="$(resolve "${1:-}")"; xcrun simctl shutdown "$u" 2>/dev/null || true; echo "shut down $u" ;;
  mem)
    # Simulator processes are Mac processes whose binaries live under CoreSimulator; Safari's page
    # runs in com.apple.WebKit.WebContent, its WebGL and media in com.apple.WebKit.GPU.
    secs="${1:-0}"; peak=0; t=0
    while :; do
      pids="$(ps -axo pid=,command= | grep -E 'CoreSimulator.*com\.apple\.WebKit\.(WebContent|GPU)' | grep -v grep | awk '{print $1}' || true)"
      [ -n "$pids" ] || { echo "no simulator WebKit process (open the game first: ios-sim.sh open)" >&2; exit 1; }
      total=0
      for p in $pids; do
        name="$(ps -o command= -p "$p" | sed -n 's/.*com\.apple\.WebKit\.\([A-Za-z]*\).*/\1/p' | head -1)"
        fp="$(footprint -f bytes --pid "$p" 2>/dev/null | sed -n 's/.*Footprint: *\([0-9][0-9]*\) B.*/\1/p' | head -1)"
        rss="$(ps -o rss= -p "$p" | tr -d ' ')"
        fpmb=$(( ${fp:-0} / 1048576 )); rssmb=$(( ${rss:-0} / 1024 ))
        total=$(( total + fpmb ))
        printf '%s  %-10s pid %-6s footprint %5s MB  resident %5s MB\n' "$(date +%H:%M:%S)" "$name" "$p" "$fpmb" "$rssmb"
      done
      [ "$total" -gt "$peak" ] && peak=$total
      t=$(( t + 2 ))
      [ "$t" -gt "$secs" ] && break
      sleep 2
    done
    echo "peak WebKit footprint (all processes): $peak MB" ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
