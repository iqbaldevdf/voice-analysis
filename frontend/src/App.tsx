import { useCallback, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type { AnalysisJob } from "./api";
import { AppShell } from "./components/AppShell";
import { CallDetailsRoute } from "./views/CallDetailsRoute";
import { CallDetailsView } from "./views/CallDetailsView";
import { AgentDetailView } from "./views/AgentDetailView";
import { AgentsListView } from "./views/AgentsListView";
import { CallsListView } from "./views/CallsListView";
import { CronLogsView } from "./views/CronLogsView";
import { SyncDashboardView } from "./views/SyncDashboardView";

type ListBase = "/meetings" | "/recordings";

function MeetingsPage({ onError }: { onError: (message: string | null) => void }) {
  const navigate = useNavigate();

  return (
    <CallsListView
      mode="meetings"
      onError={onError}
      onOpenJob={(job) => openJob(navigate, "/meetings", job)}
      onOpenDbRecording={(callId, recordingId) => {
        navigate(`/meetings/${callId}/${recordingId}`);
      }}
    />
  );
}

function RecordingsPage({ onError }: { onError: (message: string | null) => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dateFilter = searchParams.get("date") ?? undefined;

  return (
    <CallsListView
      mode="recordings"
      initialDateFrom={dateFilter}
      initialDateTo={dateFilter}
      onError={onError}
      onOpenJob={(job) => openJob(navigate, "/recordings", job)}
      onOpenDbRecording={(callId, recordingId) => {
        navigate(`/recordings/${callId}/${recordingId}`);
      }}
    />
  );
}

function openJob(
  navigate: ReturnType<typeof useNavigate>,
  base: ListBase,
  job: AnalysisJob,
) {
  const callId = job.freshcallerCallId ?? job.callMeta?.callId;
  if (callId != null) {
    const fromId = job.id.match(/^db-(\d+)-(\d+)$/);
    const recordingId = fromId ? Number(fromId[2]) : undefined;
    if (recordingId != null) {
      navigate(`${base}/${callId}/${recordingId}`);
      return;
    }
  }
  navigate(`${base}/local/${encodeURIComponent(job.id)}`, { state: { job } });
}

function LocalCallDetailsPage({
  listPath,
  onError,
}: {
  listPath: ListBase;
  onError: (message: string | null) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const stateJob = (location.state as { job?: AnalysisJob } | null)?.job ?? null;
  const [job, setJob] = useState<AnalysisJob | null>(stateJob);

  if (!job) {
    return (
      <div className="empty-state">
        <h3>Session expired</h3>
        <p>Open this call again from the list.</p>
        <button type="button" className="btn secondary" onClick={() => navigate(listPath)}>
          Back to list
        </button>
      </div>
    );
  }

  return (
    <CallDetailsView
      job={job}
      onError={onError}
      onJobUpdate={setJob}
      onBack={() => navigate(listPath)}
    />
  );
}

function SyncPage({ onError }: { onError: (message: string | null) => void }) {
  const navigate = useNavigate();
  return (
    <SyncDashboardView
      onError={onError}
      onOpenLogs={(runId) => navigate(`/logs?runId=${encodeURIComponent(runId)}`)}
      onOpenRecordingsForDate={(callDate) =>
        navigate(`/recordings?date=${encodeURIComponent(callDate)}`)
      }
    />
  );
}

function LogsPage({ onError }: { onError: (message: string | null) => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get("runId");

  return (
    <CronLogsView
      initialRunId={runId}
      onError={onError}
      onGoSync={() => navigate("/sync")}
    />
  );
}

export default function App() {
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((message: string | null) => setError(message), []);

  return (
    <AppShell>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn ghost compact" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <Routes>
        <Route path="/" element={<Navigate to="/recordings" replace />} />

        <Route path="/meetings" element={<MeetingsPage onError={onError} />} />
        <Route
          path="/meetings/local/:jobId"
          element={<LocalCallDetailsPage listPath="/meetings" onError={onError} />}
        />
        <Route
          path="/meetings/:callId/:recordingId"
          element={<CallDetailsRoute listPath="/meetings" onError={onError} />}
        />

        <Route path="/recordings" element={<RecordingsPage onError={onError} />} />
        <Route
          path="/recordings/local/:jobId"
          element={<LocalCallDetailsPage listPath="/recordings" onError={onError} />}
        />
        <Route
          path="/recordings/:callId/:recordingId"
          element={<CallDetailsRoute listPath="/recordings" onError={onError} />}
        />

        <Route path="/agents" element={<AgentsListView onError={onError} />} />
        <Route path="/agents/:agentId" element={<AgentDetailView onError={onError} />} />

        <Route path="/sync" element={<SyncPage onError={onError} />} />
        <Route path="/logs" element={<LogsPage onError={onError} />} />

        <Route path="*" element={<Navigate to="/recordings" replace />} />
      </Routes>
    </AppShell>
  );
}
