import type { IConfiguration } from 'dependency-cruiser'

const config: IConfiguration = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Provider operations and command rendering must have one clear dependency direction.',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'no-unresolvable',
      comment: 'An unresolved import is an unchecked boundary, not evidence of a clean graph.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: 'providers-do-not-import-the-cli',
      comment: 'Typed provider and subprocess operations cannot depend on CLI grammar or rendering.',
      severity: 'error',
      from: { path: '^src/(agent-host|aws|auth|config|errors|harness|process|tailscale)\\.ts$' },
      to: { path: '^src/(cli|main|runtime)\\.ts$' }
    },
    {
      name: 'fixtures-do-not-enter-the-product',
      comment: 'Fixtures and contract assertions are not operator runtime dependencies.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/tests/' },
      to: { path: '^src/tests/' }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.d.ts', '.json']
    }
  }
}

export default config
