export class ClaimIdGenerator {
  private sequence: number;

  public constructor(start = 0) {
    this.sequence = start;
  }

  public next(): string {
    this.sequence += 1;
    const suffix = this.sequence.toString().padStart(6, '0');
    return `DB26-${suffix}`;
  }
}
