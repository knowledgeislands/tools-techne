export type CompletionShell = 'bash' | 'zsh'

// Provider option flags are offered only where a command has a host or controller target.
export function renderCompletion(shell: CompletionShell, providerFlags: readonly string[]): string {
  const provider = providerFlags.join(' ')
  const values = ['--host', '--harness-dir', '--recipe', '--provider', ...providerFlags].join('|')
  return shell === 'bash' ? bashCompletion(provider, values) : zshCompletion(provider, values)
}

const OPTIONS = '--host --harness-dir --json -h --help -V --version'

function bashCompletion(provider: string, values: string): string {
  return `_techne() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local previous="\${COMP_WORDS[COMP_CWORD-1]}"
  local options='${OPTIONS}'
  local provider='${provider}'
  local context='' word skip=0 i choices

  case "$previous" in
    ${values}) return ;;
  esac

  for ((i=1; i<COMP_CWORD; i++)); do
    word="\${COMP_WORDS[i]}"
    if ((skip)); then skip=0; continue; fi
    case "$word" in
      ${values}) skip=1 ;;
      -*) ;;
      *) context="\${context:+$context }$word" ;;
    esac
  done

  case "$context" in
    '') choices="diag doctor auth controller recipe host completion help $options" ;;
    diag) choices="--full $options $provider" ;;
    doctor|'auth login'|'controller status'|'controller bootstrap') choices="$options $provider" ;;
    help) choices="diag doctor auth controller recipe host completion $options" ;;
    'help auth') choices="login $options" ;;
    'help controller') choices="status bootstrap $options" ;;
    'help recipe') choices="list show $options" ;;
    'help host') choices="list add status setup start stop teardown connect $options" ;;
    auth) choices="login $options" ;;
    controller) choices="status bootstrap $options" ;;
    recipe) choices="list show $options" ;;
    host) choices="list add status setup start stop teardown connect $options" ;;
    'host add'*) choices="--recipe --provider $options" ;;
    'host status') choices="--all $options $provider" ;;
    'host setup') choices="--pull --dry-run $options $provider" ;;
    'host start'|'host stop'|'host teardown'|'host connect'*) choices="--dry-run $options $provider" ;;
    completion) choices='bash zsh' ;;
    *) choices="$options" ;;
  esac

  COMPREPLY=( $(compgen -W "$choices" -- "$current") )
}
complete -F _techne techne
`
}

function zshCompletion(provider: string, values: string): string {
  return `#compdef techne
_techne() {
  local context='' word
  local -a options provider candidates
  local -i skip=0 i
  options=(${OPTIONS})
  provider=(${provider})

  case "\${words[CURRENT-1]}" in
    ${values}) return ;;
  esac

  for ((i=2; i<CURRENT; i++)); do
    word="\${words[i]}"
    if ((skip)); then skip=0; continue; fi
    case "$word" in
      ${values}) skip=1 ;;
      -*) ;;
      *) context="\${context:+$context }$word" ;;
    esac
  done

  case "$context" in
    '') candidates=(diag doctor auth controller recipe host completion help "\${options[@]}") ;;
    diag) candidates=(--full "\${options[@]}" "\${provider[@]}") ;;
    doctor|'auth login'|'controller status'|'controller bootstrap') candidates=("\${options[@]}" "\${provider[@]}") ;;
    help) candidates=(diag doctor auth controller recipe host completion "\${options[@]}") ;;
    'help auth') candidates=(login "\${options[@]}") ;;
    'help controller') candidates=(status bootstrap "\${options[@]}") ;;
    'help recipe') candidates=(list show "\${options[@]}") ;;
    'help host') candidates=(list add status setup start stop teardown connect "\${options[@]}") ;;
    auth) candidates=(login "\${options[@]}") ;;
    controller) candidates=(status bootstrap "\${options[@]}") ;;
    recipe) candidates=(list show "\${options[@]}") ;;
    host) candidates=(list add status setup start stop teardown connect "\${options[@]}") ;;
    'host add'*) candidates=(--recipe --provider "\${options[@]}") ;;
    'host status') candidates=(--all "\${options[@]}" "\${provider[@]}") ;;
    'host setup') candidates=(--pull --dry-run "\${options[@]}" "\${provider[@]}") ;;
    'host start'|'host stop'|'host teardown'|'host connect'*) candidates=(--dry-run "\${options[@]}" "\${provider[@]}") ;;
    completion) candidates=(bash zsh) ;;
    *) candidates=("\${options[@]}") ;;
  esac
  compadd -- "\${candidates[@]}"
}
compdef _techne techne
`
}
