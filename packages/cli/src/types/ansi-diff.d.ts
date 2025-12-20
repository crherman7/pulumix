/**
 * Type declarations for ansi-diff module
 */
declare module 'ansi-diff' {
  interface LogUpdateOptions {
    height: number
    width: number
  }

  interface LogUpdate {
    update(text: string): string
    resize(options: LogUpdateOptions): void
  }

  function logUpdate(options: LogUpdateOptions): LogUpdate
  export = logUpdate
}
