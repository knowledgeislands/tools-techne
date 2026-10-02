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

version=$(bun -e "console.log((await Bun.file('package.json').json()).version)")
stage=$(mktemp -d "${TMPDIR:-/tmp}/techne-release-test.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
mkdir -p "$stage/assets" "$stage/unpack"
archive=$(bash release/package.sh "v$version" "$bun_target" "$asset_target")
tar -xzf "$archive" -C "$stage/unpack"

[[ "$("$stage/unpack/techne" --version)" == "$version" ]]
"$stage/unpack/techne" --help >"$stage/help.txt"
grep -Fq 'techne completion <bash|zsh>' "$stage/help.txt"
"$stage/unpack/techne" completion bash >"$stage/techne.bash"
"$stage/unpack/techne" completion zsh >"$stage/_techne"
bash -n "$stage/techne.bash"
bash -c 'source "$1"; complete -p techne >/dev/null' _ "$stage/techne.bash"
grep -Fxq 'complete -F _techne techne' "$stage/techne.bash"
grep -Fxq '#compdef techne' "$stage/_techne"
grep -Fxq 'compdef _techne techne' "$stage/_techne"
if command -v zsh >/dev/null; then
  zsh -f -c 'fpath=("$1" $fpath); autoload -Uz compinit; compinit -D; [[ "${_comps[techne]}" == _techne ]]' _ "$stage"
fi
diagnostic=$("$stage/unpack/techne" diag --json)
bun -e '
  const report = JSON.parse(process.argv[1])
  if (report.version !== process.argv[2] || report.installation !== "release") process.exit(1)
' "$diagnostic" "$version"
mandoc -T lint "$stage/unpack/man/techne.1"

for target in darwin-arm64 darwin-x64 linux-x64; do
  cp "$archive" "$stage/assets/techne-v$version-$target.tar.gz"
done
(
  cd "$stage/assets"
  shasum -a 256 techne-v"$version"-darwin-arm64.tar.gz \
    techne-v"$version"-darwin-x64.tar.gz \
    techne-v"$version"-linux-x64.tar.gz >techne-checksums.txt
)
TECHNE_INSTALL_TEST_MODE=1 TECHNE_INSTALL_TEST_ASSETS="$stage/assets" \
  TECHNE_INSTALL_DIR="$stage/bin" TECHNE_MAN_INSTALL_DIR="$stage/man/man1" \
  bash install.sh "v$version"
[[ "$("$stage/bin/techne" --version)" == "$version" ]]
[[ -f "$stage/man/man1/techne.1" ]]
TECHNE_INSTALL_TEST_MODE=1 TECHNE_INSTALL_TEST_ASSETS="$stage/assets" \
  TECHNE_INSTALL_DIR="$stage/bin" TECHNE_MAN_INSTALL_DIR="$stage/man/man1" \
  bash install.sh "v$version" >/dev/null
original_hash=$(shasum -a 256 "$stage/bin/techne")
printf 'corruption' >>"$stage/assets/techne-v$version-$asset_target.tar.gz"
if TECHNE_INSTALL_TEST_MODE=1 TECHNE_INSTALL_TEST_ASSETS="$stage/assets" \
  TECHNE_INSTALL_DIR="$stage/bin" TECHNE_MAN_INSTALL_DIR="$stage/man/man1" \
  bash install.sh "v$version" >"$stage/rejected.out" 2>"$stage/rejected.err"; then
  printf 'techne release test: corrupt archive was installed\n' >&2
  exit 1
fi
grep -q 'checksum mismatch' "$stage/rejected.err"
[[ "$(shasum -a 256 "$stage/bin/techne")" == "$original_hash" ]]

cp "$archive" "$stage/assets/techne-v$version-$asset_target.tar.gz"
if TECHNE_INSTALL_TEST_MODE=1 TECHNE_INSTALL_TEST_FAIL_MAN_REPLACE=1 TECHNE_INSTALL_TEST_ASSETS="$stage/assets" \
  TECHNE_INSTALL_DIR="$stage/bin" TECHNE_MAN_INSTALL_DIR="$stage/man/man1" \
  bash install.sh "v$version" >"$stage/rejected.out" 2>"$stage/rejected.err"; then
  printf 'techne release test: failed manual replacement changed the installation\n' >&2
  exit 1
fi
grep -q 'restored previous executable' "$stage/rejected.err"
[[ "$(shasum -a 256 "$stage/bin/techne")" == "$original_hash" ]]

printf 'release package and installer smoke test passed: %s\n' "$archive"
