import { isUnclearAudio } from "../lib/audioClarity";

type Props = {
  flag?: string | null;
};

export function UnclearAudioBadge({ flag }: Props) {
  if (!isUnclearAudio(flag)) return null;
  return (
    <span
      className="badge warn"
      style={{ marginLeft: 6 }}
      title="Recording reliability — not agent performance. Transcript may be inaccurate."
    >
      Unclear audio
    </span>
  );
}
