import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Use", description: "The terms for using the Winners Team website and workspace." };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Use</h1>
      <p className="text-sm">Last updated: 23 November 2026</p>
      <p>By creating an account or using the Winners Team workspace, you agree to these terms.</p>

      <h2>Membership</h2>
      <ul>
        <li>Anyone can apply to join. Every registration is reviewed and may be approved or declined by the Winners Team administration.</li>
        <li>Give accurate information when you register and keep your profile up to date.</li>
        <li>Keep your password private. You are responsible for activity on your account.</li>
      </ul>

      <h2>Using the workspace</h2>
      <ul>
        <li>Record your tasks, goals and prospecting honestly. Performance scores are calculated from what you record.</li>
        <li>Respect other members and administrators. Do not try to access records that are not yours.</li>
        <li>Do not misuse the platform, upload harmful content or interfere with how it works.</li>
      </ul>

      <h2>Accountability</h2>
      <p>
        When performance falls below the required level, the platform assigns an accountability activity as described in your
        workspace. Activities are chosen fairly by the system, and members with a recorded physical accommodation are never
        given physical activities.
      </p>

      <h2>Books and content</h2>
      <p>
        Recommended books link only to legal sources. Commercial titles must be bought or borrowed. The LEX assistant gives
        guidance only; please use your own judgement for important decisions.
      </p>

      <h2>Account changes</h2>
      <p>
        The Winners Team administration may deactivate or remove accounts that break these terms. Your history is kept so that
        team records remain accurate.
      </p>

      <h2>Changes to these terms</h2>
      <p>We may update these terms from time to time. The date at the top shows when they were last changed.</p>
    </>
  );
}
