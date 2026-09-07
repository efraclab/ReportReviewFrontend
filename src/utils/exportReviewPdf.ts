import type { ReviewResult } from "../types/ReviewResult";
import type { IssueSeverity } from "../types/DocumentReview";
import type { ReportMetadata } from "../services/pdfReviewClient";
// NOTE: ReportMetadata must include the following fields for full cover-page rendering:
//   samplingDate, receiptDate, analysisStartDate, analysisEndDate, method, sampleId, nabl
// Add them to the ReportMetadata interface in pdfReviewClient if not already present.

interface ExportMeta {
  fileNames: string[];
  generatedAt?: Date;
  model?: string;
  correlationId?: string;
  /** Organisation name shown in the letterhead, e.g. "Edward Food Research & Analysis Centre Ltd" */
  orgName?: string;
  /** Sub-line under org name, e.g. "AQIMA Group · Kolkata · NABL TC-5817" */
  orgSub?: string;
  /** Per-document metadata extracted by AI (parallel call) */
  metadata?: ReportMetadata[];
  /** Registration review mode selected by the reviewer. */
  reviewMode?: "full" | "technical" | "administrative";
}

const EFRAC_LOGO_URL = new URL(
  "../assets/EFRAC-QIMA-Logo-01.jpg",
  import.meta.url,
).href;
const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error:      "ERROR",
  warning:    "WARNING",
  suggestion: "INFO",
};

const SEVERITY_CLASS: Record<IssueSeverity, string> = {
  error:      "sev-block",
  warning:    "sev-warn",
  suggestion: "sev-info",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-GB", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function shortRef(correlationId?: string, reportNo?: string): string {
  if (correlationId) return correlationId.replace(/-/g, "").slice(0, 8).toUpperCase();
  if (reportNo) return reportNo;
  return "";
}

/* ─────────────────────────────────────────────
   Per-page SBP-style header + footer
───────────────────────────────────────────── */
function letterheadHdr(
  _orgName: string,
  _orgSub: string,
  rightLine1: string,
  rightLine2: string,
): string {
  return `
    <div class="pdf-hdr">
      <div class="pdf-hdr-copy">
        <div class="pdf-hdr-title">${escapeHtml(rightLine1)}</div>
        <div class="pdf-hdr-subtitle">${escapeHtml(rightLine2)}</div>
      </div>
      <div class="pdf-hdr-logo-wrap">
        <img class="pdf-hdr-logo" src="${EFRAC_LOGO_URL}" alt="EFRAC - A QIMA Company" />
      </div>
    </div>`;
}

function letterheadFtr(refLabel: string, pageLabel: string): string {
  return `
    <div class="pdf-ftr">
      <div>EFRAC AI Platform &nbsp;|&nbsp; Edward Food Research &amp; Analysis Centre Ltd., Kolkata &nbsp;|&nbsp; Confidential</div>
      <div>${escapeHtml(refLabel)} &nbsp;|&nbsp; ${escapeHtml(pageLabel)}</div>
    </div>`;
}

/* ─────────────────────────────────────────────
   Cover page
───────────────────────────────────────────── */
function buildCoverPage(
  result: ReviewResult,
  meta: ExportMeta,
  reportRef: string,
  generatedAt: Date,
  errorCount: number,
  warningCount: number,
  orgName: string,
  orgSub: string,
): string {
  const totalDocs    = result.documents.length;
  const allIssues    = result.documents.flatMap((d) => d.issues);
  const reportIssues = allIssues.filter((i) => i.severity === "error" || i.severity === "warning");
  const overallIssuesPct = Math.max(0, Math.min(100, 100 - result.overallScore));

  const hasErrors    = errorCount > 0;
  const verdictClass = hasErrors ? "outcome-rejected" : "outcome-approved";
  const verdictText  = hasErrors
    ? `REJECTED — ${errorCount} error${errorCount !== 1 ? "s" : ""} must be resolved before approval`
    : `APPROVED — All findings reviewed; no errors identified`;

  // ── Build "Report identification" grid from AI-extracted metadata + fallbacks
  const m0 = meta.metadata?.[0];  // first doc's metadata (most common single-doc case)
  const reviewType = meta.reviewMode
    ? `${meta.reviewMode.charAt(0).toUpperCase()}${meta.reviewMode.slice(1)} Review`
    : null;

  // Helper: render a grid row pair only when value is non-empty
  const row = (k: string, v: string | null | undefined): string =>
    v ? `<div class="gk">${escapeHtml(k)}</div><div class="gv">${escapeHtml(v)}</div>` : "";

  // For multi-doc, list file names; for single-doc use metadata title if available
  const docTitle = totalDocs === 1
    ? (m0?.reportNo
        ? `${m0.reportNo}${m0.version ? ` · ${m0.version}` : ""}`
        : meta.fileNames[0])
    : `${totalDocs} documents`;

  const coverSubLine = totalDocs === 1
    ? [m0?.customer, m0?.sample, m0?.issuedDate ? `Issued ${m0.issuedDate}` : null]
        .filter(Boolean).join(" · ") || meta.fileNames[0]
    : meta.fileNames.join(", ");


  // Run details grid
  const runRows = [
    row("Reference No.",  reportRef),
    row("Generated",      formatDateTime(generatedAt)),
    row("Review Run",     formatDateTime(new Date(result.reviewedAt))),
    row("AI Model",       meta.model ?? null),
  ].filter(Boolean).join("\n");

  return `
  <div class="page page-cover">
    <div class="cover-hero">
      <div class="cover-hero-copy">
        <div class="ct-kicker">EFRAC AI PLATFORM</div>
        <div class="ct-main">AI REVIEW REPORT</div>
        <div class="ct-report">${escapeHtml(docTitle)}</div>
        ${coverSubLine ? `<div class="ct-sub">${escapeHtml(coverSubLine)}</div>` : ""}
        <div class="ct-generated">Generated by EFRAC AI Platform</div>
        <div class="ct-org">Edward Food Research &amp; Analysis Centre Ltd., Kolkata</div>
        <div class="ct-date">Report Date: ${escapeHtml(formatDate(generatedAt))}</div>
      </div>
      <div class="cover-logo-wrap">
        <img class="cover-logo" src="${EFRAC_LOGO_URL}" alt="EFRAC - A QIMA Company" />
      </div>
    </div>
    <div class="teal-rule"></div>
    <div class="pdf-body">

      <div class="cover-sections">

        <div class="cover-block cover-identification">
          <div class="cb-label cb-teal">Report Identification</div>
          <table class="meta-table">
            <tbody>
              ${m0 ? [
                ["Report No.",         m0.reportNo],
                ["Type of Review",     reviewType],
                ["ULR",                m0.ulr],
                ["Customer",           m0.customer],
                ["Sample Description", m0.sample],
                ["Sample / Lot ID",    m0.sampleId],
                ["Matrix",             m0.matrix],
                ["Sub-labs",           m0.subLabs],
                ["Method",             m0.method],
                ["Document Class",     m0.documentClass ?? m0.version],
                ["NABL No.",           m0.nabl],
                ["Date of Issue",      m0.issuedDate],
                ["Date of Sampling",   m0.samplingDate],
                ["Date of Receipt",    m0.receiptDate],
                ["Analysis Start",     m0.analysisStartDate],
                ["Analysis End",       m0.analysisEndDate],
              ].filter(([, v]) => v != null && v !== "")
               .map(([k, v]) => `<tr><td class="mt-k">${escapeHtml(String(k))}</td><td class="mt-v">${escapeHtml(String(v))}</td></tr>`)
               .join("\n")
              : `<tr><td class="mt-k">Type of Review</td><td class="mt-v">${escapeHtml(reviewType ?? "Registration Review")}</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="cover-block cover-summary">
          <div class="cb-label cb-navy">Review Summary &middot; Registration Review &middot; ${reportIssues.length} total finding${reportIssues.length !== 1 ? "s" : ""}</div>
          <div class="tally-row">
            <div class="tally-cell tc-block">
              <div class="tc-num">${errorCount}</div>
              <div class="tc-lbl">Error</div>
            </div>
            <div class="tally-cell tc-warn">
              <div class="tc-num">${warningCount}</div>
              <div class="tc-lbl">Warning</div>
            </div>
            <div class="tally-cell tc-score">
              <div class="tc-num">${result.overallScore}</div>
              <div class="tc-lbl">Score / 100</div>
            </div>
            <div class="tally-cell tc-rate">
              <div class="tc-num">${overallIssuesPct}%</div>
              <div class="tc-lbl">Issue rate</div>
            </div>
          </div>
        </div>

        <div class="outcome-banner ${verdictClass}">
          <div class="ob-label">Final verdict</div>
          <div class="ob-text">${verdictText}</div>
        </div>

        <div class="cover-block cover-run">
          <div class="cb-label cb-slate">Run Details</div>
          <div class="cover-grid">
            ${runRows}
          </div>
        </div>

      </div>

    </div>
    ${letterheadFtr(`${orgName} · AI Review Pack · ${reportRef}`, "Page 1")}
  </div>`;
}

/* ─────────────────────────────────────────────
   Registration detail section
───────────────────────────────────────────── */
function buildDocSection(
  doc: ReviewResult["documents"][number],
  docIdx: number,
  totalDocs: number,
  orgName: string,
  orgSub: string,
  reportRef: string,
  pageNum: number,
  docMeta?: ReportMetadata,
): string {
  const errs  = doc.issues.filter((i) => i.severity === "error").length;
  const warns = doc.issues.filter((i) => i.severity === "warning").length;
  const issuesPct = Math.max(0, Math.min(100, 100 - doc.score));
  const subNum = docIdx + 1;

  const row = (k: string, v: string | null | undefined): string =>
    v ? `<div class="gk">${escapeHtml(k)}</div><div class="gv">${escapeHtml(v)}</div>` : "";

  // Build extra metadata rows if AI-extracted data is available
  const metaRows = docMeta
    ? [
        row("Report No.",        docMeta.reportNo),
        row("ULR",               docMeta.ulr),
        row("Customer",          docMeta.customer),
        row("Sample",            docMeta.sample),
        row("Sample / Lot ID",   docMeta.sampleId),
        row("Issued",            docMeta.issuedDate),
        row("Sampling Date",     docMeta.samplingDate),
        row("Receipt Date",      docMeta.receiptDate),
        row("Analysis Start",    docMeta.analysisStartDate),
        row("Analysis End",      docMeta.analysisEndDate),
        row("Matrix",            docMeta.matrix),
        row("Sub-labs",          docMeta.subLabs),
        row("Method",            docMeta.method),
        row("Document Class",    docMeta.documentClass ?? docMeta.version),
        row("NABL No.",          docMeta.nabl),
      ].filter(Boolean).join("\n")
    : "";

  // The PDF has only two finding sections:
  //   1) ERRORS
  //   2) WARNINGS
  // Head-code categories such as IDENTITY, DATES, HYGIENE, PARAMS, etc. are
  // intentionally not rendered as separate blocks.
  const errorIssues = doc.issues.filter((i) => i.severity === "error");
  const warningIssues = doc.issues.filter((i) => i.severity === "warning");

  // Each severity section has its own counter starting from 1.
  const buildCard = (
    issue: typeof doc.issues[number],
    findingIndex: number,
  ) => {
    const findingNum = String(findingIndex + 1);
    const sevClass   = SEVERITY_CLASS[issue.severity];
    const sevLabel   = SEVERITY_LABEL[issue.severity];

    // Show only the finding number here.
    // Do not expose internal head/rule labels such as:
    // REGULATORY · R-REG-METHOD-01, HYGIENE · R-HYG-..., etc.
    const refParts: string[] = [findingNum];

    return `
      <div class="finding-card finding-${sevClass}">
        <div class="fr-top">
          <span class="fr-sev ${sevClass}">${sevLabel}</span>
          <span class="fr-ref">${escapeHtml(refParts.join(" · "))}</span>
        </div>
        <div class="fr-issue">${escapeHtml(issue.title)}</div>
        ${issue.location ? `<div class="fr-location">${escapeHtml(issue.location)}</div>` : ""}
        ${issue.description ? `<div class="fr-detail">${escapeHtml(issue.description)}</div>` : ""}
        ${issue.suggestion ? `<div class="fr-action-line"><b>What to do:</b> ${escapeHtml(issue.suggestion)}</div>` : ""}
      </div>`;
  };

  const buildSeveritySection = (
    title: "ERRORS" | "WARNINGS",
    issues: typeof doc.issues,
    severityClass: "error" | "warning",
  ): string => {
    if (issues.length === 0) return "";

    const firstCard = buildCard(issues[0], 0);
    const remainingCards = issues
      .slice(1)
      .map((issue, idx) => buildCard(issue, idx + 1))
      .join("");

    const countLabel =
      title === "ERRORS"
        ? `${issues.length} Error${issues.length !== 1 ? "s" : ""}`
        : `${issues.length} Warning${issues.length !== 1 ? "s" : ""}`;

    return `
      <div class="eval-head-section severity-section severity-${severityClass}">
        <div class="eval-head-intro">
          <div class="eval-head-title severity-title severity-title-${severityClass}">
            <span class="eh-name">${title}</span>
            <span class="eh-chips">
              <span class="eh-chip ${severityClass === "error" ? "eh-chip-block" : "eh-chip-warn"}">${countLabel}</span>
            </span>
          </div>
          ${firstCard}
        </div>
        ${remainingCards}
      </div>`;
  };

  const findingsBody =
    errorIssues.length === 0 && warningIssues.length === 0
      ? `<p class="empty">No error or warning findings were recorded for this registration.</p>`
      : [
          buildSeveritySection("ERRORS", errorIssues, "error"),
          buildSeveritySection("WARNINGS", warningIssues, "warning"),
        ].filter(Boolean).join("");

  const badgeClass = errs > 0 ? "fh-badge-reject" : warns > 0 ? "fh-badge-warn" : "fh-badge-pass";
  const badgeText  = errs > 0
    ? `${errs} error${errs !== 1 ? "s" : ""} — action required`
    : warns > 0
    ? `${warns} warning${warns !== 1 ? "s" : ""} — review recommended`
    : "No errors";

  return `
  <div class="page-flow document-flow">
    <table class="flow-print-table" role="presentation">
      <thead>
        <tr><td class="flow-head-cell">
          ${letterheadHdr(orgName, orgSub, `AI REVIEW REPORT`, escapeHtml(docMeta?.reportNo ?? doc.fileName))}
        </td></tr>
      </thead>
      <tbody>
        <tr><td class="flow-body-cell">
          <div class="pdf-body">

            <div class="section-h">3.&ensp;REGISTRATION REVIEW</div>

            <div class="cover-block doc-meta-block">
              <div class="cb-label">Registration Summary</div>
              <div class="cover-grid">
                ${metaRows}
                <div class="gk">Quality Score</div><div class="gv">${doc.score}&thinsp;/&thinsp;100</div>
                <div class="gk">Issue Rate</div><div class="gv">${issuesPct}%</div>
                <div class="gk">Total Findings</div><div class="gv">${errs + warns}</div>
                <div class="gk">Breakdown</div><div class="gv">${errs} Error &middot; ${warns} Warning</div>
              </div>
              ${doc.summary ? `<div class="doc-summary"><b>Summary.</b> ${escapeHtml(doc.summary)}</div>` : ""}
            </div>

            <div class="findings-header">
              <div class="fh-label">${errs + warns} finding${errs + warns !== 1 ? "s" : ""}</div>
              <div class="fh-badge ${badgeClass}">${badgeText}</div>
            </div>
            ${findingsBody}

          </div>
        </td></tr>
      </tbody>
      <tfoot>
        <tr><td class="flow-foot-cell">
          ${letterheadFtr(`${orgName} · AI Review Pack · ${reportRef}`, `Registration Review`)}
        </td></tr>
      </tfoot>
    </table>
  </div>`;
}

/* ─────────────────────────────────────────────
   CSS
───────────────────────────────────────────── */
const CSS = `
  @page {
    size: A4;
    margin: 11mm 10mm 16mm 10mm;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --navy: #203f6d;
    --navy-dark: #183456;
    --teal: #1f7779;
    --teal-dark: #155f62;
    --orange: #ed7300;
    --green: #365d25;
    --red: #c92a25;
    --amber: #d78911;
    --blue: #2e76b5;
    --ink: #1f2b3a;
    --muted: #667085;
    --line: #cfd5dc;
    --soft: #f4f6f8;
  }

  html, body {
    background: #e9ecef;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10px;
    line-height: 1.45;
    color: var(--ink);
  }

  .page-cover {
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    background: #fff;
    margin: 20px auto 0;
    display: flex;
    flex-direction: column;
    box-shadow: 0 2px 12px rgba(0,0,0,.16);
    position: relative;
  }

  .page-flow {
    width: 210mm;
    background: #fff;
    margin: 0 auto;
    box-shadow: 0 2px 12px rgba(0,0,0,.16);
  }

  .page-flow + .page-flow { border-top: 1px solid #d8dde3; }
  .page-flow:last-child { margin-bottom: 16px; }

  /* Repeating print frame. Using a real table header/footer makes Chrome repeat
     exactly one EFRAC header/logo and one footer on every physical printed page
     when a section spans multiple pages. */
  .flow-print-table {
    width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
    table-layout: fixed;
  }
  .flow-print-table > thead { display: table-header-group; }
  .flow-print-table > tbody { display: table-row-group; }
  .flow-print-table > tfoot { display: table-footer-group; }
  .flow-head-cell, .flow-body-cell, .flow-foot-cell {
    padding: 0;
    border: 0;
    vertical-align: top;
  }

  /* ---------- Cover hero ---------- */
  .cover-hero {
    min-height: 57mm;
    background: var(--navy);
    color: #fff;
    padding: 10mm 11mm 8mm;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8mm;
  }

  .cover-hero-copy { flex: 1; min-width: 0; text-align: center; padding-left: 30mm; }
  .cover-logo-wrap {
    width: 38mm;
    background: #fff;
    padding: 2.2mm 2.5mm;
    align-self: flex-start;
    margin-top: -5.5mm;
    margin-right: -4mm;
    box-shadow: 0 1px 2px rgba(0,0,0,.12);
  }
  .cover-logo { width: 100%; height: auto; display: block; }

  .ct-kicker {
    font-size: 8px;
    letter-spacing: .15em;
    font-weight: 700;
    color: #cbd7e7;
    text-transform: uppercase;
    margin-bottom: 2.5mm;
  }
  .ct-main {
    font-size: 21px;
    line-height: 1.08;
    font-weight: 800;
    color: #fff;
    letter-spacing: .02em;
    margin-bottom: 1.7mm;
  }
  .ct-report {
    font-size: 11px;
    font-weight: 700;
    color: #dfe9f5;
    margin-bottom: 1.4mm;
    font-family: 'Courier New', monospace;
  }
  .ct-sub { font-size: 9px; color: #d6dfeb; margin-bottom: 3.2mm; }
  .ct-generated {
    display: inline-block;
    background: var(--teal);
    color: #fff;
    font-size: 8px;
    font-weight: 700;
    padding: 1.2mm 2.6mm;
    margin-bottom: 1mm;
  }
  .ct-org { font-size: 8px; color: #e5ebf3; }
  .ct-date { font-size: 8px; color: #cbd7e7; margin-top: .8mm; }
  .teal-rule { height: 1.4mm; background: var(--teal); }

  .page-cover .pdf-body {
    flex: 1;
    overflow: hidden;
    padding: 4mm 9mm 1.5mm;
    display: flex;
    flex-direction: column;
  }

  .page-flow .pdf-body { padding: 3.8mm 9mm 6mm; }

  /* ---------- Interior header ---------- */
  .pdf-hdr {
    min-height: 18mm;
    background: var(--navy);
    color: #fff;
    padding: 3mm 9mm 2.7mm;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6mm;
    border-bottom: 1.2mm solid var(--teal);
  }
  .pdf-hdr-copy { min-width: 0; flex: 1; }
  .pdf-hdr-title {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pdf-hdr-subtitle {
    margin-top: .8mm;
    font-size: 7.5px;
    color: #d7e0ec;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pdf-hdr-logo-wrap {
    width: 38mm;
    background: #fff;
    padding: 2.2mm 2.5mm;
    align-self: flex-start;
    margin-top: -1.7mm;
    margin-right: -2mm;
    box-shadow: 0 1px 2px rgba(0,0,0,.12);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pdf-hdr-logo { width: 100%; height: auto; display: block; }

  /* ---------- Cover content ---------- */
  .cover-sections {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3.2mm;
    padding-top: 2mm;
  }

  .cover-block {
    border: .35mm solid var(--line);
    background: #fff;
  }
  .cb-label {
    font-size: 8px;
    line-height: 1;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    padding: 1.5mm 2.4mm;
    color: #fff;
    margin: 0;
  }
  .cb-teal { background: var(--teal); }
  .cb-navy { background: var(--navy); }
  .cb-slate { background: #575b60; }

  .meta-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  .meta-table tr { border-bottom: .25mm solid #e0e4e8; }
  .meta-table tr:last-child { border-bottom: none; }
  .meta-table td { padding: 1.35mm 2.4mm; vertical-align: top; }
  .mt-k { width: 42mm; color: #4d5d73; font-size: 8px; font-weight: 700; }
  .mt-v { color: var(--ink); font-weight: 500; }

  .cover-grid {
    display: grid;
    grid-template-columns: 31mm 1fr 31mm 1fr;
    gap: 1.2mm 4mm;
    font-size: 8.8px;
    padding: 2.2mm 2.7mm;
  }
  .gk { color: #4d5d73; font-size: 8px; font-weight: 700; }
  .gv { color: var(--ink); font-weight: 500; }

  .tally-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding: 2.8mm 2.4mm;
    gap: 0;
  }
  .tally-cell {
    min-height: 21mm;
    border: .3mm solid #d2d7dc;
    border-right: none;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    background: #fafbfc;
  }
  .tally-cell:last-child { border-right: .3mm solid #d2d7dc; }
  .tc-num { font-size: 20px; font-weight: 800; line-height: 1; margin-bottom: 1.1mm; }
  .tc-lbl { font-size: 7px; color: #667085; line-height: 1.15; text-transform: uppercase; }
  .tc-block .tc-num { color: var(--red); }
  .tc-warn .tc-num { color: var(--orange); }
  .tc-score .tc-num { color: var(--green); }
  .tc-rate .tc-num { color: var(--navy); }

  .outcome-banner {
    border: .35mm solid;
    padding: 2.4mm 3mm;
    display: grid;
    grid-template-columns: 30mm 1fr;
    align-items: center;
    gap: 4mm;
  }
  .outcome-rejected { border-color: #e3a39e; background: #fff3f1; }
  .outcome-approved { border-color: #a9c79a; background: #f0f7ea; }
  .ob-label { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
  .outcome-rejected .ob-label { color: #a61e18; }
  .outcome-approved .ob-label { color: #2f5f24; }
  .ob-text { font-size: 9.5px; font-weight: 700; }

  /* ---------- Section bars ---------- */
  .section-h,
  h2.section-top {
    background: var(--navy);
    color: #fff;
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .025em;
    padding: 1.6mm 2.4mm;
    margin: 0 0 2.7mm;
    border: none;
    page-break-after: avoid;
    break-after: avoid;
  }
  h2.section-top .num { color: #d9e3ee; margin-right: 1mm; }

  .doc-meta-block { margin-bottom: 3mm; border: .3mm solid var(--line); }
  .doc-meta-block .cb-label { background: var(--teal); }
  .doc-meta-block .cover-grid { padding: 2.6mm 3mm; }

  .doc-summary {
    margin: 0 3mm 2.8mm;
    padding: 2mm 0 0;
    border-top: .25mm dashed #c9ced5;
    font-size: 8.8px;
    line-height: 1.5;
    color: #354052;
  }
  .doc-summary b { color: var(--navy); text-transform: uppercase; font-size: 7.5px; letter-spacing: .04em; }

  .findings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #efefef;
    border: .3mm solid #c9ced4;
    padding: 1.7mm 2.5mm;
    margin-bottom: 2.2mm;
    page-break-after: avoid;
    break-after: avoid;
  }
  .fh-label { font-size: 8.5px; font-weight: 800; }
  .fh-badge { font-size: 7.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .fh-badge-reject { color: #a61e18; }
  .fh-badge-warn { color: #9b5c00; }
  .fh-badge-pass { color: #2e6020; }

  .eval-head-section { margin-top: 3mm; }

  /*
   * A category heading must never be stranded at the bottom of a page.
   * The heading and its first finding are wrapped together so that, when
   * there is insufficient space, both move to the next page as one block.
   */
  .eval-head-intro {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .eval-head-title {
    display: flex;
    align-items: center;
    gap: 2mm;
    background: #e8eaed;
    border: .3mm solid #c7ccd2;
    padding: 1.45mm 2.6mm;
    page-break-after: avoid;
    break-after: avoid;
  }
  .eh-name {
    flex: 1;
    font-size: 8.2px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: #2e3745;
  }
  .eh-chips { display: flex; gap: 1mm; }
  .eh-chip {
    color: #fff;
    font-size: 6.7px;
    line-height: 1;
    font-weight: 800;
    padding: 1mm 1.7mm;
  }
  .eh-chip-block { background: var(--red); }
  .eh-chip-warn { background: var(--orange); }
  .eh-chip-info { background: var(--blue); }

  /* ---------- Finding cards ---------- */
  .finding-card {
    border: .3mm solid #cfd4d9;
    border-left-width: 1mm;
    background: #fff;
    padding: 2.4mm 2.8mm;
    margin-top: 1.7mm;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .finding-card.finding-sev-block { border-left-color: var(--red); }
  .finding-card.finding-sev-warn { border-left-color: var(--orange); }
  .finding-card.finding-sev-info { border-left-color: var(--blue); }

  .fr-top { display: flex; align-items: center; gap: 1.6mm; margin-bottom: 1.2mm; }
  .fr-sev {
    color: #fff;
    font-size: 6.7px;
    line-height: 1;
    font-weight: 800;
    letter-spacing: .05em;
    padding: 1mm 1.7mm;
  }
  .fr-sev.sev-block { background: var(--red); }
  .fr-sev.sev-warn { background: var(--orange); }
  .fr-sev.sev-info { background: var(--blue); }
  .fr-ref { font-family: 'Courier New', monospace; font-size: 7.2px; color: #7b8491; }
  .fr-issue { font-size: 9px; font-weight: 800; color: #1c2736; margin-bottom: 1mm; }
  .fr-location { font-family: 'Courier New', monospace; font-size: 7.5px; color: #8a929d; margin-bottom: .8mm; }
  .fr-detail { font-size: 8.4px; color: #3b4656; line-height: 1.48; }
  .fr-action-line {
    margin-top: 1.4mm;
    padding: 1.7mm 2.2mm;
    background: #eef5fb;
    border-left: .8mm solid var(--blue);
    font-size: 8.2px;
    line-height: 1.42;
  }
  .fr-action-line b { color: #15558b; }

  p.empty {
    padding: 2.5mm;
    border: .3mm solid var(--line);
    color: #6f7782;
    font-style: italic;
  }

  /* ---------- Summary table ---------- */
  table.summary {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 3.5mm;
    font-size: 8.5px;
  }
  table.summary th,
  table.summary td {
    padding: 1.55mm 2.2mm;
    border: .25mm solid #cdd2d8;
    text-align: left;
  }
  table.summary thead th {
    background: var(--teal);
    color: #fff;
    font-size: 7px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  table.summary tbody tr:nth-child(even) { background: #f6f7f8; }
  table.summary td.value { text-align: right; font-weight: 800; }
  table.summary tr.total td { background: #eceff2; font-weight: 800; }

  p.body-text {
    font-size: 8.7px;
    line-height: 1.55;
    color: #344054;
    text-align: justify;
    margin-bottom: 3mm;
  }

  /* ---------- Footer ---------- */
  .pdf-ftr {
    margin-top: 4mm;
    min-height: 8mm;
    padding: 2mm 9mm 1.4mm;
    border-top: .25mm solid #aeb6c0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 5mm;
    color: #6f7782;
    font-size: 6.6px;
  }
  .page-cover .pdf-ftr { margin-top: auto; }

  /* Universal physical-page footer. Hidden on screen; during printing Chrome
     repeats this fixed element at the bottom of every physical A4 page. */
  .print-fixed-footer {
    display: none;
  }

  @media print {
    html, body { background: #fff; }

    /* Do not use content-flow footers in print; otherwise a short section can
       place its footer halfway down a physical page. */
    .page-cover > .pdf-ftr,
    .flow-print-table > tfoot {
      display: none !important;
    }

    /* One footer for the physical page, repeated by Chromium on every page. */
    .print-fixed-footer {
      display: flex !important;
      position: fixed !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 1.5mm !important;
      height: 6mm;
      padding: 1.3mm 0 0;
      border-top: .25mm solid #aeb6c0;
      justify-content: space-between;
      align-items: center;
      gap: 5mm;
      color: #6f7782;
      background: #fff;
      font-size: 6.6px;
      line-height: 1.1;
      overflow: hidden;
      white-space: nowrap;
      z-index: 9999;
    }

    /* Reserve clearance above the repeated footer so findings never collide
       with it on a dense continuation page. */
    .page-flow .pdf-body {
      padding-bottom: 14mm !important;
    }

    .page-cover {
      width: 100% !important;
      height: auto !important;
      min-height: 100vh;
      overflow: visible !important;
      margin: 0 !important;
      box-shadow: none !important;
      page-break-after: always;
      break-after: page;
      display: flex;
      flex-direction: column;
    }

    .page-cover .pdf-body { flex: 1; }

    .page-flow {
      width: 100% !important;
      margin: 0 !important;
      box-shadow: none !important;
    }

    /* Cover -> executive summary starts on a fresh page. */
    .page-cover + .page-flow {
      page-break-before: always;
      break-before: page;
    }

    /* The document-detail report must never begin halfway down the executive
       summary page. After this first break, its table header repeats naturally
       on every continuation page without creating a second logo on one page. */
    .document-flow {
      page-break-before: always !important;
      break-before: page !important;
    }

    .page-flow + .page-flow { border-top: none; }

    .flow-print-table {
      width: 100% !important;
      border-collapse: collapse !important;
    }
    .flow-print-table > thead { display: table-header-group !important; }
    .flow-print-table > tfoot { display: none !important; }

    .finding-card,
    .doc-meta-block,
    .eval-head-intro,
    table.summary {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .findings-header,
    .section-h,
    h2.section-top,
    .eval-head-title {
      page-break-after: avoid;
      break-after: avoid;
    }

    body {
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
  }
`;

/* ─────────────────────────────────────────────
   MAIN EXPORT FUNCTION
───────────────────────────────────────────── */
export function exportReviewToPdf(result: ReviewResult, meta: ExportMeta): void {
  const generatedAt     = meta.generatedAt ?? new Date();
  const totalDocs       = result.documents.length;
  const allIssues       = result.documents.flatMap((d) => d.issues);
  const errorCount      = allIssues.filter((i) => i.severity === "error").length;
  const warningCount    = allIssues.filter((i) => i.severity === "warning").length;
  const reportFindingCount = errorCount + warningCount;
  // For single-doc export (Export Report button), use that doc's own score, not the batch average
  const effectiveScore  = totalDocs === 1 ? result.documents[0].score : result.overallScore;
  const overallIssuesPct = Math.max(0, Math.min(100, 100 - effectiveScore));
  // meta.metadata[0] is the primary doc's metadata (ReviewPage passes [docMeta] for single-doc)
  const m0First         = meta.metadata?.[0];
  const reportRef       = shortRef(meta.correlationId, m0First?.reportNo!);

  const orgName = meta.orgName ?? "LIMS Review";
  const orgSub  = meta.orgSub  ?? "AI-Assisted Document Analysis";

  /* Page 1 — Cover */
  const coverPage = buildCoverPage(
    result, meta, reportRef, generatedAt,
    errorCount, warningCount,
    orgName, orgSub,
  );

  /* Page 2 — Executive summary + methodology (flows into doc detail) */
  const execPage = `
  <div class="page-flow exec-flow">
    <table class="flow-print-table" role="presentation">
      <thead>
        <tr><td class="flow-head-cell">
          ${letterheadHdr(orgName, orgSub, "AI Review Report", "Executive Summary & Methodology")}
        </td></tr>
      </thead>
      <tbody>
        <tr><td class="flow-body-cell">
          <div class="pdf-body">

      <h2 class="section-top"><span class="num">1.</span>Executive Summary</h2>
      <p class="body-text">
        This report presents the findings of an AI-assisted review of the registration submitted on
        ${escapeHtml(formatDate(generatedAt))}. The analysis identified
        ${reportFindingCount} finding${reportFindingCount !== 1 ? "s" : ""}
        comprising ${errorCount} error${errorCount !== 1 ? "s" : ""} and
        ${warningCount} warning${warningCount !== 1 ? "s" : ""}.
        The aggregate issue rate is <strong>${overallIssuesPct}%</strong>
        (overall quality score: ${effectiveScore}&thinsp;/&thinsp;100).
      </p>

      <table class="summary">
        <thead>
          <tr>
            <th>Finding Category</th>
            <th style="width:22mm;text-align:right">Count</th>
            <th style="width:22mm;text-align:right">Share</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Errors — must be resolved</td>
            <td class="value">${errorCount}</td>
            <td class="value">${reportFindingCount ? Math.round((errorCount / reportFindingCount) * 100) : 0}%</td>
          </tr>
          <tr>
            <td>Warnings — should be addressed</td>
            <td class="value">${warningCount}</td>
            <td class="value">${reportFindingCount ? Math.round((warningCount / reportFindingCount) * 100) : 0}%</td>
          </tr>
          <tr class="total">
            <td><strong>Total Findings</strong></td>
            <td class="value">${reportFindingCount}</td>
            <td class="value">—</td>
          </tr>
        </tbody>
      </table>

      <h2 class="section-top" style="margin-top:12px;"><span class="num">2.</span>Scope &amp; Methodology</h2>
      <p class="body-text">
        The registration data was processed by
        the ${escapeHtml(meta.model ?? "configured AI")} large-language model and evaluated
        against completeness of required fields, formatting and structural consistency,
        regulatory references, date and identifier conventions, and the presence of factual
        or compliance gaps. Findings are grouped into two review sections:
        <strong>Error</strong> (must be resolved before approval) and
        <strong>Warning</strong> (should be reviewed and remediated where applicable).
        Quality score: 100 = ready to submit.
      </p>

          </div>
        </td></tr>
      </tbody>
      <tfoot>
        <tr><td class="flow-foot-cell">
          ${letterheadFtr(`${orgName} · AI Review Pack · ${reportRef}`, "Executive Summary")}
        </td></tr>
      </tfoot>
    </table>
  </div>`;

  /* Pages 3+ — registration detail */
  const docPages = result.documents
    .map((doc, idx) =>
      buildDocSection(doc, idx, totalDocs, orgName, orgSub, reportRef, idx + 3, meta.metadata?.[idx])
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>AI Review Pack — ${escapeHtml(reportRef)}</title>
<style>${CSS}</style>
</head>
<body>
  ${coverPage}
  ${execPage}
  ${docPages}

  <div class="print-fixed-footer">
    <div>EFRAC AI Platform &nbsp;|&nbsp; Edward Food Research &amp; Analysis Centre Ltd., Kolkata &nbsp;|&nbsp; Confidential</div>
    <div>AI Review Report &nbsp;|&nbsp; ${escapeHtml(reportRef)}</div>
  </div>
</body>
</html>`;

  // Render into a hidden iframe so the print dialog opens over the current page
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;border:none;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    alert("Could not create print frame. Please try again.");
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  // Wait for iframe content + images to load, then print
  const doPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* ignore */ }
    // Remove iframe after a delay to let the print dialog fully open
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { /* already removed */ }
    }, 2000);
  };

  if (iframe.contentDocument?.readyState === "complete") {
    doPrint();
  } else {
    iframe.addEventListener("load", doPrint, { once: true });
    setTimeout(doPrint, 1200);
  }
}