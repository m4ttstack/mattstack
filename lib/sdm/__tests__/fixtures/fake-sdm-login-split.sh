#!/bin/bash
# Mimics `sdm login` writing its auth URL in two pipe chunks, with the break
# inside the token, then a last line with no newline, its check mark split
# across two chunks, before it exits.
if [ "$1" = "login" ]; then
  printf 'Please complete logging in at: https://app.strongdm.com/auth-confirm-native/split4'
  sleep 0.3
  printf '56secret\n'
  sleep 0.1
  printf 'authentication successful \xe2\x9c'
  sleep 0.3
  printf '\x93'
  exit 0
fi
exit 64
