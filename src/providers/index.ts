import { awsProvider } from './aws/index.ts'
import type { Provider } from './provider.ts'

// The provider adapters this release carries; a binding's provider table selects one.
export const PROVIDERS: readonly Provider[] = [awsProvider]
