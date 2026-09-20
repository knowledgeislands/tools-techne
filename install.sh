#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
install_dir=${TECHNE_INSTALL_DIR:-"$HOME/.local/bin"}
man_install_dir=${TECHNE_MAN_INSTALL_DIR:-"$(dirname -- "$install_dir")/share/man/man1"}
target="$install_dir/techne"
man_target="$man_install_dir/techne.1"
stage=''

die() {
  printf 'techne: error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./install.sh --link

Install a local-development launcher and manual from this checkout.
The launcher runs src/main.ts through the repository-pinned Bun runtime.

Immutable public installation remains deferred until the first accepted release.
EOF
}

cleanup() {
  if [[ -n "$stage" && -d "$stage" ]]; then
    rm -rf -- "$stage"
  fi
}
trap cleanup EXIT HUP INT TERM

case "${1:-}" in
  --link) ;;
  -h | --help)
    usage
    exit 0
    ;;
  '') die 'expected --link' ;;
  *) die "unknown argument: $1" ;;
esac

[[ "$#" -eq 1 ]] || die 'installer accepts exactly one argument'

if command -v mise >/dev/null 2>&1; then
  bun_executable=$(cd "$script_dir" && mise which bun) || die 'mise could not resolve checkout Bun version'
else
  bun_executable=$(command -v bun) || die 'Bun is required for local link installation'
fi

[[ "$("$bun_executable" --version)" == '1.4.1' ]] || die 'the local checkout requires Bun 1.4.1'

source_entry="$script_dir/src/main.ts"
man_source="$script_dir/man/techne.1"
[[ -f "$source_entry" ]] || die "local source entry not found: $source_entry"
[[ -f "$man_source" ]] || die "local manual not found: $man_source"

mkdir -p -- "$install_dir" "$man_install_dir"
stage=$(mktemp -d "${TMPDIR:-/tmp}/techne-install.XXXXXX") || die 'could not create staging directory'

{
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail'
  printf 'exec %q %q "$@"\n' "$bun_executable" "$source_entry"
} >"$stage/techne"
chmod 755 "$stage/techne"
ln -s "$man_source" "$stage/techne.1"

mv -f -- "$stage/techne" "$target"
mv -f -- "$stage/techne.1" "$man_target"
rmdir "$stage"
stage=''

printf 'techne: linked %s to local Bun source %s\n' "$target" "$source_entry"
printf 'techne: linked %s to %s\n' "$man_target" "$man_source"
