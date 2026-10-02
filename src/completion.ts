export type CompletionShell = 'bash' | 'zsh'

export function renderCompletion(shell: CompletionShell): string {
  return shell === 'bash' ? BASH_COMPLETION : ZSH_COMPLETION
}

const BASH_COMPLETION = `_techne() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local previous="\${COMP_WORDS[COMP_CWORD-1]}"
  local options='--profile --region --account --controller-stack --json -h --help -V --version'
  local context='' word skip=0 i choices

  case "$previous" in
    --profile|--region|--account|--controller-stack) return ;;
  esac

  for ((i=1; i<COMP_CWORD; i++)); do
    word="\${COMP_WORDS[i]}"
    if ((skip)); then skip=0; continue; fi
    case "$word" in
      --profile|--region|--account|--controller-stack) skip=1 ;;
      -*) ;;
      *) context="\${context:+$context }$word" ;;
    esac
  done

  case "$context" in
    '') choices="diag doctor auth controller completion $options" ;;
    auth) choices="login $options" ;;
    controller) choices="status bootstrap $options" ;;
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
  options=(--profile --region --account --controller-stack --json -h --help -V --version)

  case "\${words[CURRENT-1]}" in
    --profile|--region|--account|--controller-stack) return ;;
  esac

  for ((i=2; i<CURRENT; i++)); do
    word="\${words[i]}"
    if ((skip)); then skip=0; continue; fi
    case "$word" in
      --profile|--region|--account|--controller-stack) skip=1 ;;
      -*) ;;
      *) context="\${context:+$context }$word" ;;
    esac
  done

  case "$context" in
    '') candidates=(diag doctor auth controller completion "\${options[@]}") ;;
    auth) candidates=(login "\${options[@]}") ;;
    controller) candidates=(status bootstrap "\${options[@]}") ;;
    completion) candidates=(bash zsh) ;;
    *) candidates=("\${options[@]}") ;;
  esac
  compadd -- "\${candidates[@]}"
}
compdef _techne techne
`
