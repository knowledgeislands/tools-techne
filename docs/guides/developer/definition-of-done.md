# Definition of done for tools-techne

Use this checklist before presenting a `tools-techne` change for review.

The `ki-repo-tools` change-readiness checklist owns cross-tool documentation, verification, and authority questions; the checks below apply them to Techne's typed operations and release artifacts.

## Tool contract

- `bin/techne` is the primary source launcher and `src/version.ts` is the authoritative executable version.
- `--help`, `--version`, generated Bash/Zsh completion, README, user guides, the Pre-1.0 changelog baseline and `techne(1)` describe the same public command surface.
- Command grammar and rendering remain separate from typed provider operations and subprocess execution.
- Diagnostics exclude credentials and numeric operator identifiers.
- Removed or deferred behaviour leaves no misleading compatibility surface.

## Distribution support

- `install.sh --link` installs a checkout-bound launcher and manual into explicit local destinations.
- `install.sh` installs latest or exact immutable release archives and verifies the checksum manifest, archive layout and executable version before replacing installed files.
- `release/package.sh` produces a platform archive containing `techne` and `man/techne.1`.
- Release workflow validates an existing exact semantic-version tag, builds three supported targets, publishes checksums and verifies a draft release installation before publication.
- `CHANGELOG.md` records the active semantic-version baseline.
- `techne completion <bash|zsh>` prints shell definitions without changing user startup files or completion directories.

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

Exercise mutating behaviour only against isolated fixtures. Live AWS operations and remote-environment management remain separately controlled.

## Review

- Commit one coherent, verified unit with only intended paths staged.
- Record unavailable checks, known gaps and receiver-owned follow-up explicitly.
- Verify the repository visibility, immutable release and Homebrew formula before describing those channels as available.
