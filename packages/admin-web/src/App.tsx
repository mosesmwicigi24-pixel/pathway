// Multiplier/admin portal shell (spec §1.3). Two screens to start: the cohort
// engagement table (the defining view) and the reflection-review queue.
import { useState, type ReactElement } from "react";
import { CohortTable } from "./components/CohortTable";
import { ReviewQueue } from "./components/ReviewQueue";

type Tab = "cohort" | "reviews";

export function App(): ReactElement {
  const [tab, setTab] = useState<Tab>("cohort");

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>Nuru Place · Multiplier Portal</h1>
      <nav style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <button type="button" onClick={() => setTab("cohort")} disabled={tab === "cohort"}>
          Cohort
        </button>
        <button type="button" onClick={() => setTab("reviews")} disabled={tab === "reviews"}>
          Reviews
        </button>
      </nav>
      {tab === "cohort" ? <CohortTable /> : <ReviewQueue />}
    </main>
  );
}
