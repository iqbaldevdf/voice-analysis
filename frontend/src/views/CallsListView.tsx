import { useCallback, useEffect, useState } from "react";
import {
  analyzeDbRecording,
  fetchDbRecordings,
  fetchRecordingListings,
  formatDurationLong,
  uploadAndAnalyze,
  type AnalysisJob,
  type DbRecordingListItem,
  type DbRecordingsQuery,
} from "../api";
import {
  CheckboxField,
  SearchField,
  SelectField,
  TextField,
} from "../components/ui/Fields";
import { agentDisplayName, agentInitials } from "../lib/agentInitials";

type Props = {
  mode: "meetings" | "recordings";
  initialDateFrom?: string;
  initialDateTo?: string;
  onOpenJob: (job: AnalysisJob) => void;
  onOpenDbRecording: (callId: number, recordingId: number) => void;
  onError: (message: string | null) => void;
};

type SortKey = "createdTime" | "durationSec" | "agentName" | "analysisStatus" | "callId";

function analysisBadge(status: DbRecordingListItem["analysisStatus"]): string {
  switch (status) {
    case "completed":
      return "Notes ready";
    case "running":
    case "queued":
      return "Transcribing…";
    case "failed":
      return "Failed";
    default:
      return "Needs analysis";
  }
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function meetingTitle(rec: DbRecordingListItem): string {
  const customer = rec.customerName || "Customer";
  const agent = agentDisplayName(rec.agentName);
  return `${agent} ↔ ${customer}`;
}

const PAGE_SIZE = 10;

export function CallsListView({
  mode,
  initialDateFrom,
  initialDateTo,
  onOpenJob,
  onOpenDbRecording,
  onError,
}: Props) {
  const [recordings, setRecordings] = useState<DbRecordingListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialDateTo ?? "");
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("createdTime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [excludeVoicemail, setExcludeVoicemail] = useState(true);
  const [analyzingIds, setAnalyzingIds] = useState<string[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [voicemailMaxSec, setVoicemailMaxSec] = useState(30);

  useEffect(() => {
    if (initialDateFrom != null) setDateFrom(initialDateFrom);
    if (initialDateTo != null) setDateTo(initialDateTo);
  }, [initialDateFrom, initialDateTo]);

  const buildQuery = useCallback(
    (pageNum: number): DbRecordingsQuery => ({
      q: search.trim() || undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      minDuration: minDuration !== "" ? Number(minDuration) : undefined,
      maxDuration: maxDuration !== "" ? Number(maxDuration) : undefined,
      sortBy,
      sortDir,
      page: pageNum,
      limit: PAGE_SIZE,
      excludeVoicemail,
    }),
    [search, statusFilter, dateFrom, dateTo, minDuration, maxDuration, sortBy, sortDir, excludeVoicemail],
  );

  const refresh = useCallback(
    async (pageNum = 1) => {
      setLoading(true);
      try {
        const query = buildQuery(pageNum);
        const data =
          mode === "recordings"
            ? await fetchRecordingListings(query)
            : await fetchDbRecordings(query);
        setRecordings(data.recordings);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setPage(data.page);
        setVoicemailMaxSec(data.voicemailMaxSec ?? 30);
      } finally {
        setLoading(false);
      }
    },
    [buildQuery, mode],
  );

  useEffect(() => {
    if (initialDateFrom) setDateFrom(initialDateFrom);
    if (initialDateTo) setDateTo(initialDateTo);
  }, [initialDateFrom, initialDateTo]);

  useEffect(() => {
    void refresh(1).catch((err) => onError(err instanceof Error ? err.message : String(err)));
  }, [mode, sortBy, sortDir, excludeVoicemail, dateFrom, dateTo]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    try {
      onError(null);
      await refresh(1);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  function recordingKey(rec: DbRecordingListItem): string {
    return `${rec.callId}-${rec.recordingId}`;
  }

  async function handleViewAnalysis(rec: DbRecordingListItem) {
    if (rec.analysisStatus === "completed") {
      onOpenDbRecording(rec.callId, rec.recordingId);
      return;
    }
    const key = recordingKey(rec);
    if (analyzingIds.includes(key)) {
      onError(`Analysis is already running for call ${rec.callId}. Wait for it to finish.`);
      return;
    }

    try {
      onError(null);
      setAnalyzingIds((current) => [...current, key]);
      const data = await analyzeDbRecording(rec.callId, rec.recordingId);
      await refresh(page);
      onOpenDbRecording(data.recording.callId, data.recording.recordingId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      void refresh(page).catch(() => undefined);
    } finally {
      setAnalyzingIds((current) => current.filter((id) => id !== key));
    }
  }

  async function handleUpload(file: File | null) {
    if (!file) return;
    try {
      onError(null);
      setUploadBusy(true);
      const data = await uploadAndAnalyze(file);
      onOpenJob(data.job);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadBusy(false);
    }
  }

  function toggleSort(column: SortKey) {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir(column === "agentName" ? "asc" : "desc");
    }
  }

  function sortMarker(column: SortKey) {
    if (sortBy !== column) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const title = mode === "recordings" ? "Recordings" : "Meetings";

  return (
    <div className="meetings-page">
      <header className="viewport-header">
        <div>
          <h1>{title}</h1>
        </div>
        {mode !== "recordings" && (
          <div className="viewport-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                void refresh(page).catch((err) =>
                  onError(err instanceof Error ? err.message : String(err)),
                )
              }
            >
              Refresh
            </button>
            <label className="btn primary file-btn">
              {uploadBusy ? "Uploading…" : "Upload recording"}
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.webm"
                hidden
                disabled={uploadBusy}
                onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        )}
      </header>

      <form className="filter-panel" onSubmit={(e) => void handleSearch(e)}>
        <div className="filter-panel-grid">
          <SearchField
            id="meetings-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Agent, customer, phone, call ID…"
            className="filter-span-2"
          />
          <SelectField
            id="meetings-status"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="none">Needs analysis</option>
            <option value="completed">Notes ready</option>
            <option value="running">Transcribing</option>
            <option value="failed">Failed</option>
          </SelectField>
          <TextField
            id="meetings-from"
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <TextField
            id="meetings-to"
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          <TextField
            id="meetings-min-dur"
            label="Min duration (s)"
            type="number"
            min={0}
            placeholder="60"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
          />
          <TextField
            id="meetings-max-dur"
            label="Max duration (s)"
            type="number"
            min={0}
            placeholder="600"
            value={maxDuration}
            onChange={(e) => setMaxDuration(e.target.value)}
          />
        </div>
        <div className="filter-panel-footer">
          <CheckboxField
            id="meetings-hide-vm"
            label={`Hide voicemails (≤${voicemailMaxSec}s)`}
            checked={excludeVoicemail}
            onChange={(e) => setExcludeVoicemail(e.target.checked)}
          />
          <button type="submit" className="btn secondary">
            Apply filters
          </button>
        </div>
      </form>

      <div className="list-meta-row">
        <span>
          {total} result{total === 1 ? "" : "s"} · page {page} of {totalPages}
        </span>
        <div className="sort-controls">
          <SelectField
            id="meetings-sort-by"
            label="Sort by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
          >
            <option value="createdTime">Date</option>
            <option value="durationSec">Duration</option>
            <option value="agentName">Agent</option>
            <option value="analysisStatus">Status</option>
            <option value="callId">Call ID</option>
          </SelectField>
          <SelectField
            id="meetings-sort-dir"
            label="Order"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </SelectField>
        </div>
      </div>

      {mode === "meetings" ? (
        <section className="meetings-feed">
          {loading ? (
            <p className="empty soft">Loading meetings…</p>
          ) : recordings.length === 0 ? (
            <div className="empty-state">
              <h3>No meetings match</h3>
              <p>Try widening the date range or clearing duration filters.</p>
            </div>
          ) : (
            recordings.map((rec) => {
              const when = rec.createdTime ? new Date(rec.createdTime) : null;
              const busy = analyzingIds.includes(recordingKey(rec));
              const ready = rec.analysisStatus === "completed";
              return (
                <article key={`${rec.callId}-${rec.recordingId}`} className="meeting-card">
                  <div className="meeting-avatars" aria-hidden>
                    <span className="avatar agent">{agentInitials(rec.agentName)}</span>
                    <span className="avatar customer">
                      {initials(rec.customerName || "Customer")}
                    </span>
                  </div>
                  <div className="meeting-body">
                    <div className="meeting-title-row">
                      <h3>{meetingTitle(rec)}</h3>
                      <span
                        className={`badge ${
                          ready ? "ok" : rec.analysisStatus === "failed" ? "danger" : "muted"
                        }`}
                      >
                        {analysisBadge(rec.analysisStatus)}
                      </span>
                    </div>
                    <p className="meeting-meta">
                      <span>FC-{rec.callId}</span>
                      <span className="dot" />
                      <span className="capitalize">{rec.direction || "call"}</span>
                      <span className="dot" />
                      <span>
                        {when
                          ? when.toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </span>
                      <span className="dot" />
                      <span>
                        {rec.durationSec != null ? formatDurationLong(rec.durationSec) : "—"}
                      </span>
                    </p>
                  </div>
                  <div className="meeting-actions">
                    <button
                      type="button"
                      className={`btn ${ready ? "secondary" : "primary"} compact`}
                      disabled={busy}
                      onClick={() => void handleViewAnalysis(rec)}
                    >
                      {busy ? "Analyzing…" : ready ? "View notes" : "Generate notes"}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      ) : (
        <section className="panel recordings-table-panel">
          {loading ? (
            <p className="empty soft">Loading recordings…</p>
          ) : recordings.length === 0 ? (
            <div className="empty-state">
              <h3>No recordings in listing table</h3>
              <p>Import calls or clear filters. Voicemails are excluded by default.</p>
            </div>
          ) : (
            <div className="table-wrap recordings-table-wrap">
              <table className="data-table sortable-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="th-sort" onClick={() => toggleSort("callId")}>
                        Call ID{sortMarker("callId")}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => toggleSort("agentName")}
                      >
                        Agent{sortMarker("agentName")}
                      </button>
                    </th>
                    <th>Customer</th>
                    <th>Answered</th>
                    <th>Direction</th>
                    <th>
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => toggleSort("createdTime")}
                      >
                        When{sortMarker("createdTime")}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => toggleSort("durationSec")}
                      >
                        Duration{sortMarker("durationSec")}
                      </button>
                    </th>
                    <th>Audio</th>
                    <th>
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => toggleSort("analysisStatus")}
                      >
                        Analysis{sortMarker("analysisStatus")}
                      </button>
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recordings.map((rec) => (
                    <tr key={`${rec.callId}-${rec.recordingId}`}>
                      <td>{rec.callId}</td>
                      <td>{rec.agentName ? agentDisplayName(rec.agentName) : "—"}</td>
                      <td>{rec.customerName || "—"}</td>
                      <td>
                        <span className={`badge ${rec.answered ? "ok" : "muted"}`}>
                          {rec.answered ? "Answered" : "Not answered"}
                        </span>
                      </td>
                      <td className="capitalize">{rec.direction || "—"}</td>
                      <td>
                        {rec.createdTime ? new Date(rec.createdTime).toLocaleString() : "—"}
                      </td>
                      <td>
                        {rec.durationSec != null ? formatDurationLong(rec.durationSec) : "—"}
                      </td>
                      <td>
                        <span className={rec.hasLocalAudio ? "badge ok" : "badge warn"}>
                          {rec.hasLocalAudio ? "On disk" : "Missing"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            rec.analysisStatus === "completed"
                              ? "ok"
                              : rec.analysisStatus === "failed"
                                ? "danger"
                                : "muted"
                          }`}
                        >
                          {analysisBadge(rec.analysisStatus)}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn primary compact"
                          disabled={analyzingIds.includes(recordingKey(rec))}
                          onClick={() => void handleViewAnalysis(rec)}
                        >
                          {analyzingIds.includes(recordingKey(rec))
                            ? "Analyzing…"
                            : rec.analysisStatus === "completed"
                              ? "Open"
                              : "Analyze"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div className="pagination-bar">
        <button
          type="button"
          className="btn ghost compact"
          disabled={page <= 1 || loading}
          onClick={() =>
            void refresh(page - 1).catch((err) =>
              onError(err instanceof Error ? err.message : String(err)),
            )
          }
        >
          Previous
        </button>
        <span>
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          className="btn ghost compact"
          disabled={page >= totalPages || loading}
          onClick={() =>
            void refresh(page + 1).catch((err) =>
              onError(err instanceof Error ? err.message : String(err)),
            )
          }
        >
          Next
        </button>
      </div>
    </div>
  );
}
