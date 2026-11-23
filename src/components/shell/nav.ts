import type { Role } from "@/lib/auth";

export type NavItem = { href: string; label: string; icon: string; badgeKey?: "pending" };
export type NavSection = { title: string; items: NavItem[] };

const productivity: NavSection = {
  title: "Productivity & Execution",
  items: [
    { href: "/tasks", label: "My To-Do Checklists", icon: "checklist" },
    { href: "/weekly-goals", label: "Weekly Goals", icon: "track_changes" },
    { href: "/monthly-goals", label: "Monthly Goals", icon: "flag" },
    { href: "/prospecting", label: "Prospecting", icon: "contact_page" },
  ],
};

const growth = (role: Role): NavSection => ({
  title: "Accountability & Growth",
  items: [
    { href: "/accountability", label: role === "team_member" ? "Accountability & Spin Wheel" : "Accountability Ledger", icon: "cyclone" },
    { href: "/service-updates", label: "Professional Service Updates", icon: "feed" },
    { href: "/books", label: "Recommended Books & Reading", icon: "menu_book" },
  ],
});

const account: NavSection = {
  title: "Account",
  items: [
    { href: "/profile", label: "My Unified Profile", icon: "badge" },
    { href: "/notifications", label: "Notifications & Reminders", icon: "notifications" },
    { href: "/lex", label: "LEX Assistant", icon: "smart_toy" },
  ],
};

export function navFor(role: Role): NavSection[] {
  if (role === "super_admin") {
    return [
      { title: "Dashboard & Overviews", items: [
        { href: "/super-admin", label: "Executive Dashboard", icon: "dashboard" },
        { href: "/super-admin/analytics", label: "Organisation Analytics", icon: "insights" },
        { href: "/reports", label: "Reports & Exports", icon: "summarize" },
      ] },
      { title: "Governance & Hierarchy", items: [
        { href: "/super-admin/registrations", label: "Pending Registrations", icon: "how_to_reg", badgeKey: "pending" },
        { href: "/super-admin/administrators", label: "Administrator Directory", icon: "admin_panel_settings" },
        { href: "/super-admin/assignments", label: "Team Assignments", icon: "account_tree" },
        { href: "/super-admin/users", label: "User Management", icon: "manage_accounts" },
      ] },
      growth(role),
      { title: "System", items: [
        { href: "/settings", label: "System Settings", icon: "tune" },
        { href: "/settings/quotes", label: "Motivational Quotes", icon: "format_quote" },
        { href: "/audit-logs", label: "Audit Logs", icon: "policy" },
      ] },
      account,
    ];
  }
  if (role === "administrator") {
    return [
      { title: "Dashboard & Overviews", items: [
        { href: "/admin", label: "Team Dashboard", icon: "dashboard" },
        { href: "/team", label: "My Team Members", icon: "groups" },
        { href: "/reports", label: "Team Reports", icon: "insights" },
      ] },
      // Administrators also get their own personal workspace (same tools as members).
      { title: "My Workspace", items: [
        ...productivity.items,
        { href: "/performance", label: "My Performance", icon: "monitoring" },
      ] },
      { title: "Governance", items: [
        { href: "/admin/announcements", label: "Team Announcements", icon: "campaign" },
        { href: "/admin/remove-member", label: "Remove a Team Member", icon: "person_remove" },
        { href: "/audit-logs", label: "Team Audit Log", icon: "policy" },
      ] },
      growth(role),
      account,
    ];
  }
  return [
    { title: "Dashboard & Overviews", items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/performance", label: "My Performance", icon: "monitoring" },
      { href: "/reports", label: "My Reports", icon: "summarize" },
    ] },
    productivity,
    growth(role),
    account,
  ];
}
