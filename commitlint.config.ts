export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'type-enum': [2, 'always', ['chore', 'docs', 'feat', 'fix', 'refactor', 'test']]
  }
}
