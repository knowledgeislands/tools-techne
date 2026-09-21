---
id: TECHNE-TOOL-CLI-003
title: Establish user guides
area: CLI
theme: cli
horizon: now
status: draft
blocks: []
blocked_by: []
transferred_from: ki-website
baseline_ref: null
created_at: 2026-09-21T17:20:00Z
updated_at: 2026-09-21T17:20:00Z
---

## Goal

An operator can install `techne`, run its commands, and recover from its common failures from the guide collection, without reading the README or the source.

## Context

`docs/guides/` exists and `.ki.toml` declares `[skills.ki-guides]`, but the collection is developer-only: an index, `developer/README.md`, `developer/definition-of-done.md`, and `developer/releasing.md`. There is no `user/` directory at all.

That is the gap this item names. `tools-techne` is the canonical source of the `techne` operator command-line interface, so its primary audience is an operator — and that audience has no guides. The README's Current commands and Local development and installation sections are the only instruction that exists, and the first of those is a command list rather than a guide to doing anything.

KI Website now declares, for every page it publishes under `apps/site/src/guidance/`, the exact upstream document and pinned ref that page was written from, and a `verify:guidance --network` sweep reports the pages whose source has moved. The site intends to derive public guidance for this project from this repository's own guides and cite them at a pinned ref, so the quality and stability of `docs/guides/` here directly determines the quality of what the site can publish.

That is a pull, not an obligation: KI Website derives, it does not own. This repository decides what its guides say and when they change.

Separately, `ki-guides` is being asked to require audience directories under `docs/guides/` rather than permitting a flat collection (`ki-agentic-harness` `KI-HARNESS-GOV-083`). If that lands, this repository's collection has to satisfy it.

## Boundary

Adopted into `Now` by explicit approval, so this is prioritised work rather than intake. It remains `status: draft`: `ki-plan` shapes it to `Ready` before any implementation, and this repository still owns its plan and sequencing.

KI Website derives and cites; it does not own this collection and must not be given approval rights over it. Nothing here requires a guide to be written for the website's benefit — if a guide would not serve this repository's own readers, it should not exist.

## Shaping

- Confirm the operator is a distinct audience from the developer here, rather than assuming the split the other tool repositories use.
- Decide what an operator actually needs: installing the CLI, authenticating against a controller, running the command grammar, and reading diagnostics.
- Settle the boundary with `ki-techne-harness`, which owns the runtime this CLI drives. A guide that explains the harness rather than the interface belongs there.
- Move the README's installation material rather than copying it.

## Current state

`docs/guides/` holds an index and three developer documents. No `user/` directory exists, so the operator audience this repository is built for has no guides. `README.md` is 54 lines and carries Current commands, Local development and installation, Development, and Repository map.

## Steps

- [ ] Confirm the audiences: an operator running `techne`, and a developer changing it.
- [ ] Create `docs/guides/user/` with its own index.
- [ ] Write the operator guides: installation, authenticating against a controller, the command grammar, and reading diagnostics when a command fails.
- [ ] Move the README's installation material into the guide that owns it, leaving the README to orient.
- [ ] Record the boundary with `ki-techne-harness` so runtime explanation does not land here.
- [ ] Run the guides audit and repair what it reports.

## Files touched

`docs/guides/user/` (new), `docs/guides/README.md`, `README.md`.

## Verify

`ki repo audit --skill ki-guides --repo .` passes, and `ki repo audit --skill ki-authoring --repo .` passes over the collection.

## Dependencies / blocks

Nothing blocks this. `KI-HARNESS-GOV-083` in `ki-agentic-harness` proposes making audience directories a `ki-guides` requirement: if it lands first this collection satisfies it by construction, and if it lands later this collection already conforms. KI Website intends to derive public guidance from these guides and cite them at a pinned ref, but it derives rather than owns and its schedule does not gate this work.

## Documentation impact

### Decision Records

No decision record is needed. Audience-centric grouping is the house arrangement `ki-guides` already encodes, so adopting it here is conformance rather than a new decision. One becomes owed only if this repository concludes it needs an exception.

### Specifications

No behaviour-level contract changes. This item changes only where instructions live and who they are written for.

### Guides

This item is entirely guide impact: it establishes or completes the collection, its audience directories, and their indexes.

### Roadmap

No further roadmap change is expected. If writing the guides exposes behaviour that cannot honestly be explained, that is a separate item raised at the time.

## Discussion

Shaping settles how far this goes, not whether it happens. The prompting question is whether a reader who has never opened this repository can do what it is for without reading source.
