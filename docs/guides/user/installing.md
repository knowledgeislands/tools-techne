# Install techne

Install the immutable `techne` release, verify its executable and manual, or link a development checkout. The first release is `v0.1.0`.

## Install an exact release

Download the installer from the exact tag and pass the same tag as its positional argument:

```sh
curl --fail --location --proto '=https' --proto-redir '=https' --output install.sh \
  https://raw.githubusercontent.com/knowledgeislands/tools-techne/v0.1.0/install.sh
bash ./install.sh v0.1.0
```

The installer chooses the macOS ARM64, macOS x64 or Linux x64 archive, checks it against the release checksum manifest, validates its contents and version, then installs the executable and manual. Run `bash ./install.sh` to install the latest published release from the same installer. The installer needs `curl`, `shasum` and `tar`; the released executable does not need Bun.

By default, files go to `~/.local/bin/techne` and `~/.local/share/man/man1/techne.1`. Set both destinations when needed:

```sh
TECHNE_INSTALL_DIR="$HOME/bin" \
TECHNE_MAN_INSTALL_DIR="$HOME/share/man/man1" \
  bash ./install.sh v0.1.0
```

## Install with Homebrew

```sh
brew install knowledgeislands/tap/techne
```

The tap formula pins the exact release archives and SHA-256 checksums and installs the same manual.

## Link a development checkout

Clone the repository, activate its pinned Bun `1.4.1` toolchain, then run this from its root:

```sh
./install.sh --link
```

The local launcher records absolute paths to the checkout and Bun executable. It does not download a release. If the checkout moves, rerun `./install.sh --link` from its new location. Destination overrides work for this mode too.

## Verify and recover

Run `techne --version` and `techne diag --json` from any directory. `diag` is offline and reports installation provenance and effective non-secret configuration. Run `man techne` if the manual directory is on `MANPATH`.

If the shell cannot find `techne`, add its installation directory to `PATH` or reinstall into a directory already there. If `man techne` cannot find the manual, add the manual directory's parent to `MANPATH` or choose a searched `TECHNE_MAN_INSTALL_DIR`. A linked launcher that cannot find `src/main.ts` needs to be recreated from the current checkout.

## Shell completion

Completion is available from a linked development checkout and will be included in the next release. The published `v0.1.0` archive and Homebrew formula do not contain this command.

`techne completion bash` and `techne completion zsh` print completion source. For the current Bash session, run `source <(techne completion bash)`. For Zsh, write `techne completion zsh` to an `_techne` file in a directory on `fpath` before `compinit` runs. Keep persistent shell setup in your shell configuration or configuration manager; the installer does not edit it.
