export type SaveStatus = 'saved' | 'saving' | 'error'
type Job = { run: () => Promise<void> }

// A failed job is retained verbatim, including its operation ID. Newer edits wait
// behind it, so retrying an uncertain response cannot accidentally lose an update.
export class SaveQueue {
  private pending = new Map<string, Job>()
  private failed: Job | undefined
  private running: Promise<void> | undefined
  private debounce: ReturnType<typeof setTimeout> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined
  status: SaveStatus = 'saved'
  error = ''
  constructor(
    private notify: () => void,
    private idleMs = 350,
    private maximumMs = 2000,
  ) {}
  useImmediateScheduling() { this.idleMs = 0; this.maximumMs = 0 }
  enqueue(key: string, run: () => Promise<void>) {
    // Move a replacement after newly queued dependencies (for example a linked note).
    this.pending.delete(key)
    this.pending.set(key, { run })
    if (this.status !== 'error') this.status = 'saving'
    this.notify()
    if (this.status === 'error') return
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      void this.flush().catch(() => {})
    }, this.idleMs)
    this.deadline ??= setTimeout(() => {
      void this.flush().catch(() => {})
    }, this.maximumMs)
  }
  private clearTimers() {
    clearTimeout(this.debounce)
    clearTimeout(this.deadline)
    this.debounce = undefined
    this.deadline = undefined
  }
  async flush(): Promise<void> {
    this.clearTimers()
    if (this.running) return this.running
    if (!this.failed && !this.pending.size) return
    this.status = 'saving'
    this.error = ''
    this.notify()
    this.running = this.drain()
    try {
      await this.running
    } finally {
      this.running = undefined
    }
  }
  private async drain() {
    try {
      while (this.failed || this.pending.size) {
        let job = this.failed
        if (!job) {
          const key = this.pending.has('preferences')
            ? 'preferences'
            : this.pending.keys().next().value!
          const next = this.pending.get(key)!
          this.pending.delete(key)
          job = next
        }
        this.failed = job
        await job.run()
        this.failed = undefined
      }
      this.status = 'saved'
    } catch (error) {
      this.status = 'error'
      this.error = String(error)
      throw error
    } finally {
      this.clearTimers()
      this.notify()
    }
  }
  get dirty() {
    return !!this.failed || !!this.pending.size || this.status === 'saving'
  }
}
