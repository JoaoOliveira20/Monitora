export interface CheckResult<Metadata = unknown> {
  targetId: string;
  success: boolean;
  checkedAt: Date;
  durationMs: number;
  error?: string;
  metadata: Metadata;
}
