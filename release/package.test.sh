#!/usr/bin/env bash
set -euo pipefail

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64 | Darwin/aarch64) bun_target=bun-darwin-arm64; asset_target=darwin-arm64 ;;
  Darwin/x86_64) bun_target=bun-darwin-x64; asset_target=darwin-x64 ;;
  Linux/x86_64 | Linux/amd64) bun_target=bun-linux-x64; asset_target=linux-x64 ;;
  *)
    printf 'techne release test: unsupported host: %s/%s\n' "$(uname -s)" "$(uname -m)" >&2
    exit 2
    ;;
esac

stage=$(mktemp -d "${TMPDIR:-/tmp}/techne-release-test.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT HUP INT TERM

archive=$(bash release/package.sh v0.1.0 "$bun_target" "$asset_target")
tar -xzf "$archive" -C "$stage"

[[ "$("$stage/techne" --version)" == '0.1.0' ]]
diagnostic=$("$stage/techne" diag --json)
bun -e '
  const report = JSON.parse(process.argv[1])
  if (report.version !== "0.1.0" || report.installation !== "release") process.exit(1)
' "$diagnostic"
mandoc -T lint "$stage/man/techne.1"

printf 'release package smoke test passed: %s\n' "$archive"
