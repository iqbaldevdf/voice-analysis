import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AnalysisJob } from "../api";
import { loadDbRecordingJob } from "../lib/recordingJob";
import { CallDetailsView } from "./CallDetailsView";

type Props = {
  listPath: "/meetings" | "/recordings";
  onError: (message: string | null) => void;
};

export function CallDetailsRoute({ listPath, onError }: Props) {
  const { callId: callIdParam, recordingId: recordingIdParam } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const callId = Number(callIdParam);
  const recordingId = Number(recordingIdParam);

  useEffect(() => {
    if (!Number.isFinite(callId) || !Number.isFinite(recordingId)) {
      onError("Invalid call or recording id");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    onError(null);

    void loadDbRecordingJob(callId, recordingId)
      .then((data) => {
        if (cancelled) return;
        setJob(data.job);
        setAudioUrl(data.audioUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        onError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [callId, recordingId, onError]);

  if (loading) {
    return <p className="empty soft">Loading call details…</p>;
  }

  if (!job) {
    return (
      <div className="empty-state">
        <h3>Call not found</h3>
        <p>This recording could not be loaded.</p>
        <button type="button" className="btn secondary" onClick={() => navigate(listPath)}>
          Back to list
        </button>
      </div>
    );
  }

  return (
    <CallDetailsView
      job={job}
      audioUrlOverride={audioUrl}
      onError={onError}
      onJobUpdate={setJob}
      onBack={() => navigate(listPath)}
    />
  );
}
