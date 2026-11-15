// Hesitation timer: Task 9 logs "hesitate" after 5 s without a step. Task 8 only starts and stops it.
export class HesitationTimer {
  running = false;
  private id: ReturnType<typeof setTimeout> | null = null;
  constructor(private onHesitate: () => void = () => {}, private ms = 5000) {}
  start(): void { this.stop(); this.running = true; this.id = setTimeout(() => { this.running = false; this.onHesitate(); }, this.ms); }
  stop(): void { if (this.id) clearTimeout(this.id); this.id = null; this.running = false; }
  /** Called on every step. */
  reset(): void { this.start(); }
}
