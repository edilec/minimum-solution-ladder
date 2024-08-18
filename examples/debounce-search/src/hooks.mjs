// Part of the example tree, not of this package's implementation.
export function useDebounced(callback, waitMs) {
  let timer = null
  const run = (...args) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => callback(...args), waitMs)
  }
  run.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return run
}
