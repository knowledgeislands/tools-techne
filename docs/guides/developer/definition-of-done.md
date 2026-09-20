# Definition of done for tools-techne

Use this checklist before presenting a `tools-techne` change for review.

## Tool contract

- `bin/techne` is the primary source launcher and `src/version.ts` is the authoritative executable version.
- `--help`, `--version`, README and `techne(1)` describe the same public command surface.
- Command grammar and rendering remain separate from typed provider operations and subprocess execution.
- Diagnostics exclude credentials and numeric operator identifiers.
- Removed or deferred behaviour leaves no misleading compatibility surface.

## Distribution support

- `install.sh --link` installs a checkout-bound launcher and manual into explicit local destinations.
- `release/package.sh` produces one deterministic platform archive containing `techne` and `man/techne.1`.
- Release workflow validates an existing exact semantic-version tag, builds three supported targets and publishes checksums.
- `CHANGELOG.md` records the active semantic-version baseline.
- Direct exact-version installer downloads and shell completion are deferred from the first implementation baseline; documentation must not claim either exists.

## Verification

Run:

```sh
bun install --frozen-lockfile
bun run test
bun run test:coverage
bun run self:typecheck
bun run build
bun run self:release:test
bun run ki:tools:lint-man
bunx biome check .
bunx rumdl check .
ki repo audit --repo .
git diff --check
```

Exercise mutating behaviour only against isolated fixtures. Live AWS operations, tags, releases and Homebrew changes require separate authority.

## Review

- Commit one coherent, verified unit with only intended paths staged.
- Record unavailable checks, known gaps and receiver-owned follow-up explicitly.
- Do not describe the repository as publicly installable until visibility, first-release and Homebrew work are accepted.
