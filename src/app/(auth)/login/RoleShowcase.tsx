"use client";

import { useState } from "react";
import { Icon, cn } from "@/components/ui";

const ROLES = [
  { key: "member", label: "Team Member", icon: "group", title: "Team Member Personal Dashboard",
    body: "Daily to-dos, weekly and monthly goals, prospecting, your live performance score, accountability, reading list and LEX.",
    tiles: [["check_circle", "Tasks"], ["track_changes", "Goals"], ["monitoring", "Performance"]] },
  { key: "admin", label: "Administrator", icon: "admin_panel_settings", title: "Administrator Team Dashboard",
    body: "Monitor your assigned team's tasks, goals, prospecting and accountability, review reports and send announcements.",
    tiles: [["groups", "Team"], ["insights", "Reports"], ["campaign", "Announce"]] },
  { key: "super", label: "Super Admin", icon: "shield_person", title: "Super Admin Executive Dashboard",
    body: "Approve registrations, invite administrators, assign teams, configure performance and accountability, and audit everything.",
    tiles: [["how_to_reg", "Approvals"], ["account_tree", "Hierarchy"], ["tune", "Settings"]] },
];

export function RoleShowcase() {
  const [active, setActive] = useState(0);
  const r = ROLES[active]!;
  return (
    <aside className="card flex flex-col p-6 md:p-8">
      <div className="eyebrow">Three workspaces, one platform</div>
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-surface-alt p-1" role="tablist">
        {ROLES.map((x, i) => (
          <button key={x.key} role="tab" aria-selected={i === active} onClick={() => setActive(i)}
            className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-body-sm font-semibold transition-colors",
              i === active ? "bg-surface text-ink shadow-card" : "text-muted-text hover:text-ink")}>
            <Icon name={x.icon} className="text-[18px]" /><span className="hidden sm:inline">{x.label}</span>
          </button>
        ))}
      </div>
      <h2 className="mt-6 font-heading text-heading-lg text-ink">{r.title}</h2>
      <p className="mt-1 text-body-md text-muted-text">{r.body}</p>
      <div className="mt-5 rounded-xl bg-surface-alt p-4">
        <div className="mb-3 flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent-red" /><span className="h-2.5 w-2.5 rounded-full bg-accent-amber" /><span className="h-2.5 w-2.5 rounded-full bg-accent-emerald" /></div>
        <div className="grid grid-cols-3 gap-2">
          {r.tiles.map(([icon, label]) => (
            <div key={label} className="flex flex-col items-center gap-1 rounded-lg bg-surface px-2 py-3 text-body-sm text-body-text">
              <Icon name={icon!} className="text-secondary" />{label}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-auto pt-6 text-body-sm text-muted-text">
        <div className="flex items-center gap-2 rounded-lg bg-surface-container-low px-3 py-2.5"><Icon name="verified_user" className="text-secondary" />Access is enforced on the server and in the database for every role.</div>
      </div>
    </aside>
  );
}
