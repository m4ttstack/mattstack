#!/bin/bash
# Print the machine's current local time, timezone, and UTC time.
set -euo pipefail

date "+Local: %Y-%m-%d %H:%M:%S %Z (UTC%z)"

# IANA zone name: /etc/localtime is a symlink into zoneinfo on macOS and most Linux;
# fall back to /etc/timezone (Debian-style) if it is not a symlink.
if [ -L /etc/localtime ]; then
  echo "Zone:  $(readlink /etc/localtime | sed 's|.*/zoneinfo/||')"
elif [ -r /etc/timezone ]; then
  echo "Zone:  $(cat /etc/timezone)"
fi

date -u "+UTC:   %Y-%m-%d %H:%M:%S"
