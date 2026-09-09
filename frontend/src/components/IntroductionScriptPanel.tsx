import type { IntroductionScriptScore } from "../api";
import { formatTime } from "../api";

type Props = {
  intro?: IntroductionScriptScore | null;
  onSeek: (seconds: number) => void;
};

function rankClass(rank: string): string {
  const value = rank.toLowerCase();
  if (value.includes("excellent")) return "ok";
  if (value.includes("good")) return "ok";
  if (value.includes("fair")) return "warn";
  return "danger";
}

export function IntroductionScriptPanel({ intro, onSeek }: Props) {
  if (!intro || intro.themesTotal === 0) return null;

  return (
    <section className="panel intro-script-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Introduction script</h2>
          <p className="panel-sub">
            Checks the agent opening (first ~2 min) for Datafortune pitch themes — similar wording counts, not exact script.
          </p>
        </div>
        <span className={`badge ${rankClass(intro.rank)}`}>{intro.rank}</span>
      </div>

      <div className="intro-script-summary">
        <div>
          <span>Score</span>
          <strong>{intro.score.toFixed(0)}</strong>
          <em>
            {intro.themesMatched}/{intro.themesTotal} themes · {intro.agentTurnsReviewed} agent turns
          </em>
        </div>
      </div>

      <ul className="intro-theme-list">
        {intro.themes.map((theme) => (
          <li key={theme.id} className={theme.matched ? "intro-theme hit" : "intro-theme miss"}>
            <span className="intro-theme-mark">{theme.matched ? "✓" : "—"}</span>
            <div>
              <strong>{theme.label}</strong>
              {theme.matched ? (
                <p>
                  Matched “{theme.matchedPhrase}”
                  {theme.quote ? ` — “${theme.quote}”` : ""}
                </p>
              ) : (
                <p className="muted-inline">Not detected in the opening</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {intro.missedThemes.length > 0 && (
        <p className="intro-missed">
          Missing: {intro.missedThemes.join(" · ")}
        </p>
      )}

      {intro.evidence.length > 0 && (
        <div className="intro-evidence">
          {(intro.evidence ?? []).map((ev, idx) => (
            <button
              key={`${ev.start}-${idx}`}
              type="button"
              className="evidence-chip"
              onClick={() => onSeek(ev.start)}
            >
              {formatTime(ev.start)} {ev.note ? `· ${ev.note}` : ""}
            </button>
          ))}
        </div>
      )}

      {intro.note && <p className="phase-msg">{intro.note}</p>}
    </section>
  );
}
