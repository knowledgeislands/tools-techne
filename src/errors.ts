export class TechneError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'TechneError'
    this.exitCode = exitCode
  }
}
