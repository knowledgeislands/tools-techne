# Definition of done for tools-techne

Use this checklist before presenting a `tools-techne` change for review. During the pre-implementation phase, mark conditions that do not yet apply explicitly rather than claiming a complete or releasable tool.

## Establish the tool contract

- The repository purpose and first public command surface are accepted before implementation expands beyond the scaffold.
- The repository contains one primary executable at `bin/techne`, with a single authoritative version source and working `--help` and `--version` output.
- The selected implementation language and toolchain are declared in `.ki.toml` through the applicable KI skills.
- Domain behaviour, command grammar, rendering, and external effects have explicit boundaries appropriate to the selected language.
- Removed or deferred behaviour leaves no misleading README, guide, help, completion, or compatibility surface.

## Establish distribution and support

- `install.sh` supports an exact release version, verifies its download, and installs idempotently into an overrideable destination.
- Automated tests cover the public command seam, invalid syntax, important failure paths, and external-effect boundaries.
- CI runs the repository's lint, type, test, and build gates on every change.
- `CHANGELOG.md` records the active semantic-version baseline.
- Help, the README, user guides, completion, and any physical manual describe the same shipped commands and options.
- A physical manual, when introduced, passes `mandoc -T lint` and is installed or linked alongside the executable.

## Verify the change

Before the toolchain exists, run the checks that are meaningful for the files present:

```sh
rumdl check README.md docs/guides
git diff --check
```

Once the repository declares its KI tool structure and implementation toolchain, run:

```sh
ki repo audit --repo .
```

Also run every repository-native lint, type, test, build, installer, completion, and manual gate documented by the implemented toolchain. Exercise mutating behaviour only against isolated fixtures.

## Prepare review

- Commit one coherent, verified unit with only intended paths staged.
- Record unavailable checks, known gaps, and receiver-owned follow-up explicitly.
- Do not describe the repository as releasable while any first-release prerequisite remains absent.
- Do not push, tag, publish, release, or change the Homebrew tap or a consumer repository without separate authority.
