#!/usr/bin/env bash
set -euo pipefail

version=${1:?usage: release/package.sh <version> <bun-target> <asset-target>}
bun_target=${2:?usage: release/package.sh <version> <bun-target> <asset-target>}
asset_target=${3:?usage: release/package.sh <version> <bun-target> <asset-target>}

[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  printf 'techne release: version must be an exact v-prefixed semantic version\n' >&2
  exit 2
}

case "$bun_target:$asset_target" in
  bun-darwin-arm64:darwin-arm64 | bun-darwin-x64:darwin-x64 | bun-linux-x64:linux-x64) ;;
  *)
    printf 'techne release: unsupported target pair: %s:%s\n' "$bun_target" "$asset_target" >&2
    exit 2
    ;;
esac

package_version=$(bun -e "console.log((await Bun.file('package.json').json()).version)")
[[ "$version" == "v$package_version" ]] || {
  printf 'techne release: requested %s does not match package.json v%s\n' "$version" "$package_version" >&2
  exit 2
}

asset="techne-${version}-${asset_target}.tar.gz"
stage="dist/release/${asset_target}"
archive="dist/${asset}"

rm -rf -- "$stage"
mkdir -p "$stage/man"
bun build --compile --minify --target="$bun_target" --outfile "$stage/techne" src/main.ts >&2
chmod 755 "$stage/techne"
cp man/techne.1 "$stage/man/techne.1"
tar -czf "$archive" -C "$stage" techne man/techne.1

[[ "$(tar -tzf "$archive")" == $'techne\nman/techne.1' ]] || {
  printf 'techne release: archive has unexpected contents\n' >&2
  exit 1
}

printf '%s\n' "$archive"
