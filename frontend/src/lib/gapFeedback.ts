export const GAP_REPORT_EVENT = "ignite:report-coverage-gap";
let pending: string | null = null;
export function requestGapReport(diagnostic: string) {
  pending = diagnostic;
  window.dispatchEvent(new Event(GAP_REPORT_EVENT));
}
export function takeGapReport() {
  const value = pending;
  pending = null;
  return value;
}