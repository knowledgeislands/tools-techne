export type CompletionShell = 'bash' | 'zsh'

export function renderCompletion(shell: CompletionShell): string {
  return shell === 'bash' ? BASH_COMPLETION : ZSH_COMPLETION
}

const BASH_COMPLETION = `_techne() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local previous="\${COMP_WORDS[COMP_CWORD-1]}"
  local options='--profile --region --account --controller-stack --host-profile --json -h --help -V --version'
  local context='' word skip=0 i choices

  case "$previous" in
    --profile|--region|--account|--controller-stack|--host-profile) return ;;
  esac

  for ((i=1; i<COMP_CWORD; i++)); do
    word="\${COMP_WORDS[i]}"
    if ((skip)); then skip=0; continue; fi
    case "$word" in
      --profile|--region|--account|--controller-stack|--host-profile) skip=1 ;;
      -*) ;;
      *) context="\${context:+$context }$word" ;;
    esac
  done

  case "$context" in
    '') choices="diag doctor auth controller host completion help $options" ;;
    diag) choices="--full $options" ;;
    help) choices="diag doctor auth controller host completion $options" ;;
    'help auth') choices="login $options" ;;
    'help controller') choices="status bootstrap $options" ;;
    'help host') choices="status start stop teardown connect $options" ;;
    auth) choices="login $options" ;;
    controller) choices="status bootstrap $options" ;;
    host) choices="status start stop teardown connect $options" ;;
    'host start'|'host stop'|'host teardown'|'host connect'*) choices="--dry-run $options" ;;
    completion) choices='bash zsh' ;;
    *) choices="$options" ;;
  esac
  COMPREPLY=( $(compgen -W "$choices" -- "$current") )
}
complete -F _techne techne
`

const ZSH_COMPLETION = `#compdef techne
_techne() {
  local context='' word
  local -a options candidates
  local -i skip=0 i
  options=(--profile --region --account --controller-stack --host-profile --json -h --help -V --version)

  case "\${words[CURRENT-1]}" in
    --profile|--region|--account|--controller-stack|--host-profile) return ;;
  esac

  for ((i=2; i<CURRENT; i++)); do
    word="\${words[i]}"
    if ((skip)); then skip=0; continue; fi
    case "$word" in
      --profile|--region|--account|--controller-stack|--host-profile) skip=1 ;;
      -*) ;;
      *) context="\${context:+$context }$word" ;;
    esac
  done

  case "$context" in
    '') candidates=(diag doctor auth controller host completion help "\${options[@]}") ;;
    diag) candidates=(--full "\${options[@]}") ;;
    help) candidates=(diag doctor auth controller host completion "\${options[@]}") ;;
    'help auth') candidates=(login "\${options[@]}") ;;
    'help controller') candidates=(status bootstrap "\${options[@]}") ;;
    'help host') candidates=(status start stop teardown connect "\${options[@]}") ;;
    auth) candidates=(login "\${options[@]}") ;;
    controller) candidates=(status bootstrap "\${options[@]}") ;;
    host) candidates=(status start stop teardown connect "\${options[@]}") ;;
    'host start'|'host stop'|'host teardown'|'host connect'*) candidates=(--dry-run "\${options[@]}") ;;
    completion) candidates=(bash zsh) ;;
    *) candidates=("\${options[@]}") ;;
  esac
  compadd -- "\${candidates[@]}"
}
compdef _techne techne
`
