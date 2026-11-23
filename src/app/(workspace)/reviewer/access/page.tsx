import { KeyRound, ShieldCheck } from "lucide-react";
import { ReviewerAccountForm } from "@/components/forms";
import { authorizedDomain } from "@/lib/config";

export const metadata = { title: "Team access" };

export default function ReviewerAccess() {
  return <>
    <header className="page-heading">
      <span className="eyebrow"><KeyRound size={16} aria-hidden="true" /> Reviewer administration</span>
      <h1>Team access</h1>
      <p>Create confirmed reviewer accounts for your Ashoka E-Club team. Applicant accounts are not available from this portal.</p>
    </header>
    <section className="measure panel card" aria-labelledby="create-reviewer-title">
      <div className="section-heading">
        <h2 id="create-reviewer-title"><ShieldCheck size={19} aria-hidden="true" /> Add a reviewer</h2>
      </div>
      <p>Only an authenticated reviewer can create another reviewer. Use an @{authorizedDomain()} email address and share the initial password securely.</p>
      <ReviewerAccountForm domain={authorizedDomain()} />
    </section>
  </>;
}
