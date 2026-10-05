# Definition of done for tools-techne

Use this checklist before presenting a `tools-techne` change for review.

Apply the `ki-repo-tools` change-readiness checklist for shared documentation, verification, and authority requirements, and `ki-git` for commit practice. The checks below are Techne's local additions; publication follows [Release tools-techne](releasing.md).

## Tool contract

- `bin/techne` is the primary source launcher; `src/version.ts` reads the authoritative executable version from `package.json`.
- Command grammar and rendering remain separate from typed provider operations and subprocess execution.
- Diagnostics exclude credentials and numeric operator identifiers.
- Provider modules cannot import CLI grammar or rendering; runtime modules cannot import fixtures. The dependency-boundary suite proves the isolated supported parser reads the actual graph and detects a deliberately violating type-only import.

## Distribution support

- `install.sh --link` installs a checkout-bound launcher and manual into explicit local destinations.
- `install.sh` installs latest or exact immutable release archives and verifies the checksum manifest, archive layout and executable version before replacing installed files.
- `release/package.sh` produces a platform archive containing `techne` and `man/techne.1`.
- Release workflow validates an existing exact semantic-version tag, builds three supported targets, publishes checksums and verifies a draft release installation before publication.

## Verification

Run:

```sh
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd tooling/boundaries
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
