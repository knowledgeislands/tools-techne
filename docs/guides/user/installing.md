# Install techne from a checkout

Use this guide to install the currently supported checkout-bound `techne` launcher and manual, verify the installation, or repair a launcher after the repository moves.

No immutable public release or Homebrew package is available yet. The local launcher records absolute paths to this checkout and its Bun executable.

## Before you begin

- Clone or otherwise obtain this `tools-techne` checkout.
- Install `mise` with the repository toolchain activated, or install Bun `1.4.1` directly.
- Ensure the installation directories are writable and the executable directory is on `PATH`.

## Install the launcher

From the repository root, run:

```sh
./install.sh --link
```

By default, the installer writes `techne` to `~/.local/bin/techne` and links the manual at `~/.local/share/man/man1/techne.1`. To use other destinations, set both explicitly:

```sh
TECHNE_INSTALL_DIR="$HOME/bin" \
TECHNE_MAN_INSTALL_DIR="$HOME/share/man/man1" \
  ./install.sh --link
```

The only installation mode is `--link`; `--help` shows usage. The installer does not download a release or modify the checkout.

## Verify

Run these checks from any directory:

```sh
command -v techne
techne --version
techne diag
```

`techne diag` is offline. It reports installation provenance, runtime information, and effective non-secret configuration without contacting AWS.

If the manual directory is visible to `man`, also run:

```sh
man techne
```

## Recovery

If `techne` reports that `src/main.ts` cannot be found, the launcher still points at an old checkout location. Run `./install.sh --link` again from the current checkout.

If the installer reports the wrong Bun version, activate the repository's `mise` toolchain or install Bun `1.4.1`, then rerun it. If the shell cannot find `techne`, add `TECHNE_INSTALL_DIR` to `PATH` or reinstall to a directory already present there.

If `man techne` cannot find the manual, add the parent manual directory to `MANPATH` or choose a `TECHNE_MAN_INSTALL_DIR` already searched by `man`, then rerun the installer.
