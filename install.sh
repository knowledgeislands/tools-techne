#!/usr/bin/env bash
set -euo pipefail

base=https://github.com/knowledgeislands/tools-techne
install_dir=${TECHNE_INSTALL_DIR:-"$HOME/.local/bin"}
man_dir=${TECHNE_MAN_INSTALL_DIR:-"$(dirname "$install_dir")/share/man/man1"}
stage=''
new_bin=''
new_man=''
die() { printf 'techne: error: %s\n' "$*" >&2; exit 1; }
cleanup() {
  if [[ -n "$new_bin" ]]; then rm -f -- "$new_bin"; fi
  if [[ -n "$new_man" ]]; then rm -f -- "$new_man"; fi
  if [[ -n "$stage" && -d "$stage" ]]; then rm -rf -- "$stage"; fi
}
trap cleanup EXIT HUP INT TERM
usage() {
  cat <<'USAGE'
Usage: ./install.sh [vX.Y.Z|--link]
Install the latest release, an exact release, or link this checkout.
USAGE
}
[[ "$#" -le 1 ]] || die 'installer accepts at most one argument'
mode=release
version=''
case "${1:-}" in
  '') ;;
  --link) mode='link' ;;
  -h|--help) usage; exit 0 ;;
  v*) version=$1 ;;
  *) die 'expected an exact version such as v0.1.1, or --link' ;;
esac
exact_version() { [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
if [[ -n "$version" ]]; then exact_version "$version" || die 'version must match vX.Y.Z'; fi

install_link() {
  local script_dir bun_executable source_entry man_source
  script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
  if command -v mise >/dev/null 2>&1; then
    bun_executable=$(cd "$script_dir" && mise which bun) || die 'mise could not resolve checkout Bun version'
  else
    bun_executable=$(command -v bun) || die 'Bun is required for local link installation'
  fi
  [[ "$("$bun_executable" --version)" == '1.4.1' ]] || die 'the local checkout requires Bun 1.4.1'
  source_entry="$script_dir/src/main.ts"
  man_source="$script_dir/man/techne.1"
  [[ -f "$source_entry" && -f "$man_source" ]] || die 'local source or manual is missing'
  mkdir -p -- "$install_dir" "$man_dir"
  stage=$(mktemp -d "${TMPDIR:-/tmp}/techne-install.XXXXXX") || die 'could not create staging directory'
  {
    printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail'
    printf 'exec %q %q "$@"\n' "$bun_executable" "$source_entry"
  } >"$stage/techne"
  chmod 755 "$stage/techne"
  ln -s "$man_source" "$stage/techne.1"
  mv -f -- "$stage/techne" "$install_dir/techne"
  mv -f -- "$stage/techne.1" "$man_dir/techne.1"
  printf 'techne: linked %s to local Bun source %s\n' "$install_dir/techne" "$source_entry"
  printf 'techne: linked %s to %s\n' "$man_dir/techne.1" "$man_source"
}
download() {
  local name=$1 output=$2
  if [[ "${TECHNE_INSTALL_TEST_MODE:-}" == 1 ]]; then
    [[ -n "${TECHNE_INSTALL_TEST_ASSETS:-}" ]] || die 'test asset directory is required'
    cp -- "$TECHNE_INSTALL_TEST_ASSETS/$name" "$output" || die "missing test asset: $name"
  else
    curl --fail --silent --show-error --location --max-redirs 3 --proto '=https' --proto-redir '=https' \
      --output "$output" "$base/releases/download/$version/$name" || die "could not download $name"
  fi
}
latest_version() {
  local final_url
  final_url=$(curl --fail --silent --show-error --location --max-redirs 3 --proto '=https' \
    --proto-redir '=https' --output /dev/null --write-out '%{url_effective}' "$base/releases/latest") || die 'could not resolve latest release'
  version=${final_url##*/releases/tag/}
  if [[ "$version" == "$final_url" ]] || ! exact_version "$version"; then
    die 'latest release is not an exact semantic version'
  fi
}
asset_target() {
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64|Darwin/aarch64) printf '%s\n' darwin-arm64 ;;
    Darwin/x86_64) printf '%s\n' darwin-x64 ;;
    Linux/x86_64|Linux/amd64) printf '%s\n' linux-x64 ;;
    *) die 'unsupported platform (supported: darwin-arm64, darwin-x64, linux-x64)' ;;
  esac
}
manifest_hash() {
  local manifest=$1 asset=$2 line hash filename count=0 selected='' arm=0 intel=0 linux=0
  [[ -s "$manifest" && "$(tail -c 1 "$manifest" | od -An -t x1 | tr -d '[:space:]')" == 0a ]] || die 'invalid checksum manifest'
  while IFS= read -r line; do
    [[ "$line" =~ ^([0-9a-f]{64})[[:space:]][[:space:]](techne-v[0-9]+\.[0-9]+\.[0-9]+-(darwin-arm64|darwin-x64|linux-x64)\.tar\.gz)$ ]] || die 'malformed checksum manifest'
    hash=${BASH_REMATCH[1]}
    filename=${BASH_REMATCH[2]}
    case "$filename" in
      "techne-$version-darwin-arm64.tar.gz") ((arm += 1)) ;;
      "techne-$version-darwin-x64.tar.gz") ((intel += 1)) ;;
      "techne-$version-linux-x64.tar.gz") ((linux += 1)) ;;
      *) die 'checksum manifest version mismatch' ;;
    esac
    if [[ "$filename" == "$asset" ]]; then selected=$hash; fi
    ((count += 1))
  done <"$manifest"
  [[ "$count" == 3 && "$arm" == 1 && "$intel" == 1 && "$linux" == 1 && -n "$selected" ]] || die 'checksum manifest must list all three assets once'
  printf '%s\n' "$selected"
}
verify_archive() {
  local members
  members=$(tar -tzf "$1") || die 'release archive could not be read'
  [[ "$members" == $'techne\nman/techne.1' ]] || die 'release archive has unexpected contents'
  tar -tvzf "$1" | awk 'NR <= 2 { if (substr($0, 1, 1) != "-") exit 1; next } { exit 1 } END { if (NR != 2) exit 1 }' || die 'release archive contains a non-regular member'
}
install_release() {
  local platform asset expected_hash actual_hash extract had_bin=0 manual_replaced=0
  command -v curl >/dev/null 2>&1 || die 'curl is required'
  command -v shasum >/dev/null 2>&1 || die 'shasum is required'
  if [[ -z "$version" ]]; then latest_version; fi
  platform=$(asset_target)
  asset="techne-$version-$platform.tar.gz"
  stage=$(mktemp -d "${TMPDIR:-/tmp}/techne-install.XXXXXX") || die 'could not create staging directory'
  download techne-checksums.txt "$stage/techne-checksums.txt"
  expected_hash=$(manifest_hash "$stage/techne-checksums.txt" "$asset")
  download "$asset" "$stage/$asset"
  actual_hash=$(shasum -a 256 "$stage/$asset")
  [[ "${actual_hash%% *}" == "$expected_hash" ]] || die 'release archive checksum mismatch'
  verify_archive "$stage/$asset"
  extract="$stage/extract"
  mkdir "$extract"
  tar -xzf "$stage/$asset" -C "$extract" || die 'release archive extraction failed'
  [[ -f "$extract/techne" && ! -L "$extract/techne" && -x "$extract/techne" &&
     -f "$extract/man/techne.1" && ! -L "$extract/man/techne.1" ]] || die 'invalid release files'
  [[ "$("$extract/techne" --version)" == "${version#v}" ]] || die 'release executable version mismatch'
  mkdir -p -- "$install_dir" "$man_dir"
  new_bin=$(mktemp "$install_dir/.techne.new.XXXXXX") || die 'could not stage executable'
  new_man=$(mktemp "$man_dir/.techne.1.new.XXXXXX") || die 'could not stage manual'
  install -m 0755 "$extract/techne" "$new_bin" || die 'could not stage executable'
  install -m 0644 "$extract/man/techne.1" "$new_man" || die 'could not stage manual'
  if [[ -e "$install_dir/techne" || -L "$install_dir/techne" ]]; then
    cp -P -- "$install_dir/techne" "$stage/previous-techne" || die 'could not back up executable'
    had_bin=1
  fi
  if ! mv -f -- "$new_bin" "$install_dir/techne"; then die 'could not replace executable'; fi
  if [[ "${TECHNE_INSTALL_TEST_MODE:-}" == 1 && "${TECHNE_INSTALL_TEST_FAIL_MAN_REPLACE:-}" == 1 ]]; then
    manual_replaced=0
  elif mv -f -- "$new_man" "$man_dir/techne.1"; then
    manual_replaced=1
  else
    manual_replaced=0
  fi
  if [[ "$manual_replaced" == 0 ]]; then
    if [[ "$had_bin" == 1 ]]; then
      mv -f -- "$stage/previous-techne" "$install_dir/techne" || die 'could not restore previous executable'
    else
      rm -f -- "$install_dir/techne"
    fi
    die 'could not replace manual; restored previous executable'
  fi
  printf 'techne: installed verified release %s (%s) at %s\n' "$version" "$platform" "$install_dir/techne"
  printf 'techne: installed manual at %s\n' "$man_dir/techne.1"
}
if [[ "$mode" == link ]]; then install_link; else install_release; fi
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) printf 'techne: add %s to PATH to use techne from any directory\n' "$install_dir" ;;
esac
