import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy", description: "How Winners Team collects, uses and protects your personal information." };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-sm">Last updated: 23 November 2026</p>
      <p>
        This policy explains what personal information Winners Team collects when you use this website and the Winners Team
        workspace, why we collect it and how we look after it.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and password (stored securely in encrypted form; we cannot see it).</li>
        <li><strong>Profile details you choose to add:</strong> phone number, job title, team, skills, services, portfolio links and profile photo.</li>
        <li><strong>Workspace activity:</strong> your tasks, goals, prospecting records, performance scores, accountability records, reading progress and notifications.</li>
        <li><strong>Technical information:</strong> sign-in records and, if you turn on browser notifications, a device notification address.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To create and manage your account and approve your registration.</li>
        <li>To run your workspace: reminders, performance scores, accountability, book recommendations and service updates.</li>
        <li>To let your assigned administrator and the Super Admin support and review your progress.</li>
        <li>To send you notifications in the app, by email and (if you allow it) by browser notification.</li>
        <li>To keep the platform secure, including an audit log of important changes.</li>
      </ul>

      <h2>Who can see your information</h2>
      <p>
        Your records are visible to you, to the administrator assigned to you and to the Super Admin. Other members cannot see
        your records. We do not sell your personal information.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can view and update your profile at any time in your workspace.</li>
        <li>You can choose which notifications you receive and turn browser notifications off.</li>
        <li>You can ask the Winners Team administration to correct your information or to deactivate your account.</li>
      </ul>

      <h2>Questions</h2>
      <p>If you have a question about this policy, please contact your administrator or the Winners Team administration.</p>
    </>
  );
}
