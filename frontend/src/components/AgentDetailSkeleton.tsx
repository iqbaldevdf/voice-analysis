import { Skeleton } from "./Skeleton";

function TableRowSkeleton() {
  return (
    <tr className="skeleton-row">
      <td><Skeleton width={16} height={16} /></td>
      <td><Skeleton width={96} height={14} /></td>
      <td><Skeleton width="90%" height={14} /></td>
      <td><Skeleton width={72} height={22} /></td>
      <td><Skeleton width={88} height={22} /></td>
      <td><Skeleton width={56} height={14} /></td>
      <td><Skeleton width={48} height={14} /></td>
      <td><Skeleton width={40} height={14} /></td>
      <td><Skeleton width={52} height={14} /></td>
      <td><Skeleton width={52} height={14} /></td>
      <td><Skeleton width={68} height={22} /></td>
      <td><Skeleton width={72} height={22} /></td>
      <td><Skeleton width={36} height={22} /></td>
      <td><Skeleton width={64} height={30} /></td>
    </tr>
  );
}

export function AgentDetailSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="agents-page agent-detail-skeleton" aria-busy="true" aria-label="Loading agent dashboard">
      <header className="viewport-header">
        <div className="agent-profile-head">
          <Skeleton circle width={52} height={52} />
          <div className="skeleton-stack">
            <Skeleton width={180} height={28} />
            <Skeleton width={120} height={14} />
          </div>
        </div>
        <div className="viewport-actions">
          <Skeleton width={140} height={38} />
          <Skeleton width={96} height={38} />
        </div>
      </header>

      <section className="kpi-row">
        {Array.from({ length: 6 }, (_, index) => (
          <article key={index} className="kpi-card skeleton-kpi-card">
            <Skeleton width="55%" height={12} />
            <Skeleton width={index === 0 ? 72 : "45%"} height={index === 0 ? 72 : 28} circle={index === 0} />
            <Skeleton width="70%" height={12} />
          </article>
        ))}
      </section>

      <section className="agent-meta-row">
        <article className="panel category-breakup-panel">
          <Skeleton width={160} height={18} />
          <Skeleton width={120} height={14} className="skeleton-mt-sm" />
          <div className="category-breakup-grid skeleton-mt">
            {Array.from({ length: 2 }, (_, group) => (
              <div key={group} className="category-breakup-group">
                <Skeleton width={140} height={12} />
                <div className="agent-categories skeleton-mt-sm">
                  {Array.from({ length: 3 }, (_, item) => (
                    <div key={item}>
                      <div className="perf-score-label">
                        <Skeleton width="50%" height={12} />
                        <Skeleton width={24} height={14} />
                      </div>
                      <Skeleton width="100%" height={8} className="skeleton-mt-sm" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div className="filter-panel skeleton-filter-panel">
        <div className="filter-panel-grid">
          <Skeleton height={38} className="filter-span-2" />
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </div>
        <div className="filter-panel-footer">
          <Skeleton width={220} height={16} />
          <Skeleton width={160} height={16} />
          <Skeleton width={96} height={36} />
        </div>
      </div>

      <section className="panel recordings-table-panel agent-recordings-panel">
        <Skeleton width={120} height={20} />
        <div className="recordings-actions-bar skeleton-mt">
          <Skeleton width={140} height={34} />
          <div className="sort-controls">
            <Skeleton width={120} height={38} />
            <Skeleton width={120} height={38} />
          </div>
        </div>
        <div className="table-wrap recordings-table-wrap skeleton-mt">
          <table className="data-table agent-recordings-table">
            <thead>
              <tr>
                <th />
                <th>When</th>
                <th>Customer</th>
                <th>Answered</th>
                <th>Bot</th>
                <th>Direction</th>
                <th>Duration</th>
                <th>Talk</th>
                <th>Script</th>
                <th>Speech rate</th>
                <th>Disposition</th>
                <th>Status</th>
                <th>Call score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, index) => (
                <TableRowSkeleton key={index} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="recordings-footer filter-panel-footer skeleton-mt">
          <Skeleton width={140} height={14} />
          <div className="recordings-pagination">
            <Skeleton width={80} height={32} />
            <Skeleton width={64} height={32} />
          </div>
        </div>
      </section>
    </div>
  );
}
