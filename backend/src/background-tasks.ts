/**
 * Best-effort background work inside one request (docs/ARCHITECTURE.md section 5).
 *
 * Loss is acceptable for this category; what is not acceptable is an unhandled rejection
 * killing the process or the work escaping graceful shutdown. The running set exists so
 * that shutdown can wait for started work to settle within a deadline.
 */

export interface BackgroundTasks {
  runInBackground(task: () => Promise<void>): void
  waitForBackgroundTasks(timeoutMs: number): Promise<void>
}

const runningTasks = new Set<Promise<void>>()

function wrap(task: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
  const promise = Promise.resolve()
    .then(task)
    .catch((error: unknown) => onError(error))
  runningTasks.add(promise)
  promise.finally(() => runningTasks.delete(promise))
  return promise
}

export function runInBackground(
  task: () => Promise<void>,
  onError: (error: unknown) => void = (error) => {
    console.error('[background-task] unhandled error:', error)
  },
): void {
  wrap(task, onError)
}

export async function waitForBackgroundTasks(timeoutMs: number): Promise<void> {
  const snapshot = [...runningTasks]
  if (snapshot.length === 0) return
  await Promise.race([
    Promise.allSettled(snapshot).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

export const backgroundTasks: BackgroundTasks = {
  runInBackground,
  waitForBackgroundTasks,
}
