/** Periodic job vocabulary. Handlers are wired in runtime.ts, never here. */

export type JobName = 'outbox.drain'

export type JobHandler = () => Promise<void>

export type JobHandlerRegistry = Record<JobName, JobHandler>
