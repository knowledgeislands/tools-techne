# Release tools-techne

No `techne` executable or release mechanism exists yet. Do not create the first tag or GitHub release until the repository satisfies the [definition of done](definition-of-done.md) and the release mechanism below is implemented and verified.

## Establish the first release path

Before the first release:

1. provide `bin/techne`, an authoritative semantic version, `install.sh`, automated tests, CI, and `CHANGELOG.md`;
2. document the chosen build and artifact format, including any supported platforms and runtime dependencies;
3. make the release workflow reject a mismatch between the executable version, package metadata where applicable, changelog entry, and requested `vX.Y.Z` tag before publication;
4. document and test exact-version installation from an immutable release artifact;
5. decide whether a manual and shell completion are part of the first public surface, then keep every selected surface aligned; and
6. activate and pass the applicable `ki-repo-tools` and implementation-toolchain audits.

Replace this section with exact repository commands when the build and publication mechanism is selected. Do not copy another tool's signing, packaging, or workflow commands unless `tools-techne` actually implements them.

## Publish a release

For the first and subsequent releases:

1. satisfy the repository [definition of done](definition-of-done.md) on a clean candidate;
2. select the next semantic version and record compatibility or migration impact;
3. run the complete repository-native verification and release-artifact checks;
4. commit the reviewed candidate, then obtain explicit authority to create and push the exact `vX.Y.Z` tag and publish the matching GitHub release; and
5. verify a fresh exact-version installation reports the tagged version and exposes every shipped support artifact.

Do not move or recreate a published tag. Correct a failed release from `main` and publish the next appropriate version.

## Complete downstream distribution

After immutable publication, hand the exact release to `knowledgeislands/homebrew-tap`. The tap owns the Techne formula, checksum, installation checks, and formula tests; this repository neither writes nor decides that formula.

When a validated formula reaches the tap's default branch, the tap may dispatch a verified tool-release event to explicitly enrolled consumers. Each consumer retains its own review and publication boundary. This repository stores no shared release-App credentials and does not duplicate tap or consumer verification.

A first-time consumer entry, maturity change, or consumer not enrolled in automation remains an explicit receiver-owned handoff. Supply the exact tag, immutable installer or asset URL, intended public routes, and verification expectations without transferring release authority.
