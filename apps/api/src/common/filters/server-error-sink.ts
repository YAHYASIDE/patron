/**
 * Where unexpected server errors (HTTP 5xx) are reported besides the log, so
 * the owner sees them on the dashboard's errors page. The exception filter is
 * created before dependency injection, so the feedback module plugs itself in
 * here when it starts. Reporting must never throw back into the request.
 */
export type ServerErrorReport = { message: string; method: string; path: string; status: number; correlationId: string };

let sink: ((report: ServerErrorReport) => void) | null = null;

export function setServerErrorSink(fn: ((report: ServerErrorReport) => void) | null) {
  sink = fn;
}

export function reportServerError(report: ServerErrorReport) {
  try {
    sink?.(report);
  } catch {
    /* the log already has it */
  }
}
