// Part of the example tree, not of this package's implementation.
// The worksheet cites this file as evidence that the project already reaches
// for the platform's own identifier generator.
import { randomUUID } from 'node:crypto'

export function newSessionId() {
  return randomUUID()
}
