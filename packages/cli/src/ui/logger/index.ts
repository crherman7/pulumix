/**
 * Pulumi Logger - Based on Rocketyard's proven approach
 *
 * Receives text from Pulumi onOutput and processes line by line.
 * Uses text parsing for reliable terminal output.
 */

import { createLineProcessor, LineProcessor } from './line-formatter'

// ============================================================================
// Dynamic Logger (TTY with spinners)
// ============================================================================

const isDynamic = (): boolean =>
  (process.stdout.isTTY ?? false) &&
  process.env.IS_INTERACTIVE !== 'false' &&
  process.env.CI !== 'true'

let dynamicProcessor: LineProcessor | null = null
let staticProcessor: LineProcessor | null = null

const getDynamicProcessor = (): LineProcessor => {
  if (!dynamicProcessor) {
    dynamicProcessor = createLineProcessor('dynamic')
  }
  return dynamicProcessor
}

const getStaticProcessor = (): LineProcessor => {
  if (!staticProcessor) {
    staticProcessor = createLineProcessor('static')
  }
  return staticProcessor
}

/**
 * Main logger function - pass directly to Pulumi's onOutput
 */
export const pulumiLogger = (message: string): void => {
  const processor = isDynamic() ? getDynamicProcessor() : getStaticProcessor()

  for (const char of message) {
    if (char === '\n') {
      processor.processLine()
    } else {
      processor.appendLine(char)
    }
  }
}
