import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

export type NavId = "meetings" | "recordings" | "agents" | "sync" | "logs";

type Props = {
  children: ReactNode;
};

const NAV: { id: NavId; to: string; label: string; icon: string }[] = [
  { id: "recordings", to: "/recordings", label: "Recordings", icon: "R" },
  { id: "agents", to: "/agents", label: "Agents", icon: "A" },
  { id: "sync", to: "/sync", label: "Sync", icon: "S" },
  { id: "logs", to: "/logs", label: "Logs", icon: "L" },
];

export function AppShell({ children }: Props) {
  return (
    <div className="avoma-shell">
      <aside className="avoma-sidebar" aria-label="Primary">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden>
            V
          </span>
          <div>
            <strong className="brand-name">VoiceIQ</strong>
          </div>
        </div>

        <p className="nav-section-label">Workspace</p>
        <nav className="side-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              className={({ isActive }) => `side-nav-item ${isActive ? "active" : ""}`}
            >
              <span className="nav-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="nav-label-wrap">
                <span className="nav-label">{item.label}</span>
              </span>
            </NavLink>
          ))}
        </nav>

      </aside>

      <div className="avoma-main">{children}</div>
    </div>
  );
}
