export type CreativeJobStatus = "queued" | "running" | "succeeded" | "failed" | "dead_letter";

export interface CreativeJobQueueRow {
  id: string;
  asset_id: string;
  status: CreativeJobStatus | string;
  attempt_count: number | null;
  max_attempts: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  available_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  finished_at: string | null;
}

export type CreativeJobSummary = Record<CreativeJobStatus, number>;

export const CREATIVE_JOB_STATUSES: CreativeJobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead_letter",
];

export function summarizeCreativeJobs(rows: Array<Pick<CreativeJobQueueRow, "status">>): CreativeJobSummary {
  const summary = createEmptySummary();
  for (const row of rows) {
    if (isCreativeJobStatus(row.status)) {
      summary[row.status] += 1;
    }
  }
  return summary;
}

export function getRecentActionableCreativeJobs(rows: CreativeJobQueueRow[], limit = 8) {
  return rows
    .filter((row) => row.status !== "succeeded")
    .sort((a, b) => jobTimestamp(b) - jobTimestamp(a))
    .slice(0, limit);
}

export function creativeJobStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "dead_letter":
      return "Dead letter";
    default:
      return status;
  }
}

export function canRequeueCreativeJob(status: string) {
  return status !== "succeeded";
}

export function canDeadLetterCreativeJob(status: string) {
  return status !== "succeeded" && status !== "dead_letter";
}

function createEmptySummary(): CreativeJobSummary {
  return {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead_letter: 0,
  };
}

function isCreativeJobStatus(status: string): status is CreativeJobStatus {
  return CREATIVE_JOB_STATUSES.includes(status as CreativeJobStatus);
}

function jobTimestamp(row: CreativeJobQueueRow) {
  const source = row.updated_at || row.created_at;
  const timestamp = new Date(source).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
