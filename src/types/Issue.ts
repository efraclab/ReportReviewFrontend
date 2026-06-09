import type { IssueSeverity } from "./DocumentReview";
import type { HeadCode } from "./Head";

export interface IssueEvidenceCompared {
  label: string;
  old?: string;
  new?: string;
}

export interface IssueEvidenceTraceStep {
  /** Short tag shown beside the line, e.g. "DET 1", "LLM". */
  tag: string;
  /** Plain-English description of what the step did. */
  text: string;
}

export interface IssueEvidence {
  /** Field-by-field comparison pulled from the source. */
  compared?: IssueEvidenceCompared[];
  /** One-line verdict that summarises why the rule fired. */
  verdict?: string;
  /** Rule that fired this finding. */
  rule?: { code: string; version?: string };
  /** Optional step-by-step trace of how the engine arrived at the finding. */
  trace?: IssueEvidenceTraceStep[];
  /** Optional linked records (pointers into other systems). */
  linkedRecords?: string[];
}

export interface Issue {
  id: string;
  severity: IssueSeverity;
  /** Category — which evaluation head this finding rolls up under. */
  headCode?: HeadCode;
  title: string;
  description: string;
  location: string;
  suggestion: string;
  page?: number;
  evidence?: IssueEvidence;
}
