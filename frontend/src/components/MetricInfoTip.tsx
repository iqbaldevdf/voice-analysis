type Props = {
  text: string;
  label?: string;
};

export function MetricInfoTip({ text, label = "How this is calculated" }: Props) {
  return (
    <span className="metric-info">
      <button type="button" className="metric-info-btn" aria-label={label}>
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 9v5M10 6.5h.01"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span className="metric-info-tip" role="tooltip">{text}</span>
    </span>
  );
}

type LabelProps = {
  children: string;
  help: string;
  layout?: "inline" | "corner";
};

export function MetricLabel({ children, help, layout = "inline" }: LabelProps) {
  if (layout === "corner") {
    return (
      <span className="metric-label metric-label-corner">
        <span className="metric-label-text">{children}</span>
        <MetricInfoTip text={help} />
      </span>
    );
  }

  return (
    <span className="metric-label">
      {children}
      <MetricInfoTip text={help} />
    </span>
  );
}
