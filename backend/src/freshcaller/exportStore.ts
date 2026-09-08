import type { ExportJobRecord, FreshcallerCall } from "./types.js";

const exportJobs = new Map<number, ExportJobRecord>();
const calls = new Map<number, FreshcallerCall>();

export const exportStore = {
  upsertExport(job: ExportJobRecord): ExportJobRecord {
    exportJobs.set(job.id, job);
    return job;
  },

  getExport(id: number): ExportJobRecord | undefined {
    return exportJobs.get(id);
  },

  listExports(): ExportJobRecord[] {
    return [...exportJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  updateExport(id: number, patch: Partial<ExportJobRecord>): ExportJobRecord {
    const existing = exportJobs.get(id);
    if (!existing) {
      throw new Error(`Export job not found: ${id}`);
    }
    const updated: ExportJobRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    exportJobs.set(id, updated);
    return updated;
  },

  setCalls(next: FreshcallerCall[]): void {
    for (const call of next) {
      const previous = calls.get(call.id);
      calls.set(call.id, {
        ...call,
        localRecordingPath: previous?.localRecordingPath ?? call.localRecordingPath,
        localRecordingName: previous?.localRecordingName ?? call.localRecordingName,
      });
    }
  },

  getCall(id: number): FreshcallerCall | undefined {
    return calls.get(id);
  },

  listCalls(options?: { withRecordingOnly?: boolean }): FreshcallerCall[] {
    let list = [...calls.values()];
    if (options?.withRecordingOnly !== false) {
      list = list.filter((c) => c.recording != null);
    }
    return list.sort((a, b) => b.created_time.localeCompare(a.created_time));
  },

  updateCall(id: number, patch: Partial<FreshcallerCall>): FreshcallerCall {
    const existing = calls.get(id);
    if (!existing) {
      throw new Error(`Call not found: ${id}`);
    }
    const updated = { ...existing, ...patch };
    calls.set(id, updated);
    return updated;
  },

  clearCalls(): void {
    calls.clear();
  },
};
