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
}

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error:      "BLOCK",
  warning:    "WARN",
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
   Per-page letterhead strip + footer
───────────────────────────────────────────── */
function letterheadHdr(
  _orgName: string,
  _orgSub: string,
  _rightLine1: string,
  _rightLine2: string,
): string {
  return "";
}

function letterheadFtr(_refLabel: string, _pageLabel: string): string {
  return "";
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
  suggestionCount: number,
  orgName: string,
  orgSub: string,
): string {
  const totalDocs    = result.documents.length;
  const allIssues    = result.documents.flatMap((d) => d.issues);
  const overallIssuesPct = Math.max(0, Math.min(100, 100 - result.overallScore));

  const hasErrors    = errorCount > 0;
  const verdictClass = hasErrors ? "outcome-rejected" : "outcome-approved";
  const verdictText  = hasErrors
    ? `REJECTED — ${errorCount} blocking error${errorCount !== 1 ? "s" : ""} must be resolved before approval`
    : `APPROVED — All findings reviewed; no blocking errors identified`;

  // ── Build "Report identification" grid from AI-extracted metadata + fallbacks
  const m0 = meta.metadata?.[0];  // first doc's metadata (most common single-doc case)

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
    ${letterheadHdr(orgName, orgSub, "AI Review Audit Pack", m0?.documentClass ?? m0?.reportNo ?? "NABL Document Review")}
    <div class="pdf-body">

      <div class="cover-title">
        <div class="ct-kicker">AI Review Audit Pack</div>
        <div class="ct-main">${escapeHtml(docTitle)}</div>
        ${coverSubLine ? `<div class="ct-sub">${escapeHtml(coverSubLine)}</div>` : ""}
        <div class="ct-date">${escapeHtml(formatDate(generatedAt))}</div>
      </div>

      <div class="cover-sections">

        <div class="cover-block">
          <div class="cb-label">Report identification</div>
          <table class="meta-table">
            <tbody>
              ${m0 ? [
                ["Report No.",         m0.reportNo],
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
              : `<tr><td class="mt-k">Document</td><td class="mt-v">${escapeHtml(meta.fileNames[0] ?? "")}</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="cover-block">
          <div class="cb-label">Review summary &middot; ${totalDocs} document${totalDocs !== 1 ? "s" : ""} &middot; ${allIssues.length} total finding${allIssues.length !== 1 ? "s" : ""}</div>
          <div class="tally-row">
            <div class="tally-cell tc-block">
              <div class="tc-num">${errorCount}</div>
              <div class="tc-lbl">Block</div>
            </div>
            <div class="tally-cell tc-warn">
              <div class="tc-num">${warningCount}</div>
              <div class="tc-lbl">Warn</div>
            </div>
            <div class="tally-cell tc-info">
              <div class="tc-num">${suggestionCount}</div>
              <div class="tc-lbl">Info</div>
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

        <div class="cover-block">
          <div class="cb-label">Run details</div>
          <div class="cover-grid">
            ${runRows}
          </div>
        </div>

      </div>

    </div>
    ${letterheadFtr(`${orgName} · AI Review Audit Pack · ${reportRef}`, "Page 1")}
  </div>`;
}

/* ─────────────────────────────────────────────
   Per-document detail section
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
  const sugs  = doc.issues.filter((i) => i.severity === "suggestion").length;
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

  // Group issues by headCode; preserve insertion order; ungrouped go under "General"
  const headGroups = new Map<string, typeof doc.issues>();
  for (const issue of doc.issues) {
    const head = issue.headCode?.trim() || "General";
    if (!headGroups.has(head)) headGroups.set(head, []);
    headGroups.get(head)!.push(issue);
  }

  // Global counter so finding numbers remain sequential across all groups
  let globalFIdx = 0;

  // Each finding is its own bordered card — never wrapped in a shared container
  const buildCard = (issue: typeof doc.issues[number]) => {
    const findingNum = `${subNum}.${globalFIdx + 1}`;
    globalFIdx++;
    const sevClass   = SEVERITY_CLASS[issue.severity];
    const sevLabel   = SEVERITY_LABEL[issue.severity];

    const refParts: string[] = [findingNum];
    if (issue.headCode)              refParts.push(issue.headCode);
    if (issue.evidence?.rule?.code)  refParts.push(issue.evidence.rule.code);
    if (issue.page)                  refParts.push(`p.${issue.page}`);

    return `
      <div class="finding-card">
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

  const findingsBody = doc.issues.length === 0
    ? `<p class="empty">No findings were recorded for this document.</p>`
    : Array.from(headGroups.entries()).map(([head, issues]) => {
        const headErrs  = issues.filter((i) => i.severity === "error").length;
        const headWarns = issues.filter((i) => i.severity === "warning").length;
        const headSugs  = issues.filter((i) => i.severity === "suggestion").length;
        const chips = [
          headErrs  ? `<span class="eh-chip eh-chip-block">${headErrs}&thinsp;Block</span>`  : "",
          headWarns ? `<span class="eh-chip eh-chip-warn">${headWarns}&thinsp;Warn</span>`   : "",
          headSugs  ? `<span class="eh-chip eh-chip-info">${headSugs}&thinsp;Info</span>`    : "",
        ].filter(Boolean).join("");
        return `
        <div class="eval-head-section">
          <div class="eval-head-title">
            <span class="eh-name">${escapeHtml(head)}</span>
            <span class="eh-chips">${chips}</span>
          </div>
          ${issues.map(buildCard).join("")}
        </div>`;
      }).join("");

  const badgeClass = errs > 0 ? "fh-badge-reject" : warns > 0 ? "fh-badge-warn" : "fh-badge-pass";
  const badgeText  = errs > 0
    ? `${errs} blocking error${errs !== 1 ? "s" : ""} — action required`
    : warns > 0
    ? `${warns} warning${warns !== 1 ? "s" : ""} — review recommended`
    : "No blocking errors";

  return `
  <div class="page-flow">
    ${letterheadHdr(orgName, orgSub, `Document ${subNum} of ${totalDocs} · Detail`, escapeHtml(doc.fileName))}
    <div class="pdf-body">

      <div class="section-h">3.${subNum}&ensp;${escapeHtml(doc.fileName)}</div>

      <div class="cover-block doc-meta-block">
        <div class="cb-label">Document summary</div>
        <div class="cover-grid">
          ${metaRows}
          <div class="gk">Quality Score</div><div class="gv">${doc.score}&thinsp;/&thinsp;100</div>
          <div class="gk">Issue Rate</div><div class="gv">${issuesPct}%</div>
          <div class="gk">Total Findings</div><div class="gv">${doc.issues.length}</div>
          <div class="gk">Breakdown</div><div class="gv">${errs} Block &middot; ${warns} Warn &middot; ${sugs} Info</div>
        </div>
        ${doc.summary ? `<div class="doc-summary"><b>Summary.</b> ${escapeHtml(doc.summary)}</div>` : ""}
      </div>

      <div class="findings-header">
        <div class="fh-label">${doc.issues.length} finding${doc.issues.length !== 1 ? "s" : ""}</div>
        <div class="fh-badge ${badgeClass}">${badgeText}</div>
      </div>
      ${findingsBody}

    </div>
    ${letterheadFtr(`${orgName} · AI Review Audit Pack · ${reportRef}`, `Page ${pageNum}`)}
  </div>`;
}

/* ─────────────────────────────────────────────
   CSS
───────────────────────────────────────────── */
const CSS = `
  /*
   * PRINT STRATEGY
   * --------------
   * We no longer use fixed-height .page wrappers for the detail section.
   * The cover page remains a single A4 card (fixed height) for visual design.
   * All other content flows naturally and the browser handles page breaks,
   * guided by page-break-inside: avoid on individual finding cards.
   *
   * Key decisions:
   * - .page-cover: fixed 297mm, flex column — preserves the designed layout
   * - .page-flow: auto height, flows across browser-generated pages
   * - Each .finding-card is a standalone bordered box with break-inside: avoid
   *   so it never splits across a page boundary
   */

  @page {
    size: A4;
    margin: 14mm 15mm 16mm 15mm;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: #e8e8e8;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 11px; line-height: 1.55; color: #1a1a1a;
  }

  /* ── Fixed cover page shell (screen) ── */
  .page-cover {
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    background: #fff;
    margin: 24px auto 0;
    display: flex;
    flex-direction: column;
    box-shadow: 0 2px 12px rgba(0,0,0,0.18);
    position: relative;
  }

  /* ── Flow pages: auto height, max width A4 ── */
  .page-flow {
    width: 210mm;
    background: #fff;
    margin: 0 auto;
    display: block;
    box-shadow: 0 2px 12px rgba(0,0,0,0.18);
    padding: 0;
  }
  /* Add top shadow gap between flow pages on screen */
  .page-flow + .page-flow {
    margin-top: 0;
    border-top: 1px solid #d8d8d8;
  }
  /* The last page gets bottom margin */
  .page-flow:last-child {
    margin-bottom: 16px;
  }

  /* ── pdf-body: cover page fills remaining space ── */
  .page-cover .pdf-body {
    flex: 1;
    overflow: hidden;
    padding: 10px 18px 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-bottom: 0;
  }

  /* ── pdf-body: flow pages just add padding ── */
  .page-flow .pdf-body {
    padding: 12px 18px 16px;
  }

  /* ── Letterhead header ── */
  .pdf-hdr {
    padding: 9px 18px 7px;
    border-bottom: 1.5px solid #1a1a1a;
    display: flex; justify-content: space-between; align-items: flex-start;
    flex-shrink: 0;
  }
  .pdf-hdr-l { display: flex; flex-direction: column; gap: 1px; }
  .pdf-hdr-org { font-size: 12px; font-weight: 600; color: #1a1a1a; }
  .pdf-hdr-sub { font-size: 9px; color: #555; margin-top: 1px; }
  .pdf-hdr-r { text-align: right; font-size: 9px; color: #555; line-height: 1.5; }
  .pdf-hdr-r b { display: block; color: #1a1a1a; font-size: 10.5px; font-weight: 600; }

  /* ── Cover title block ── */
  .cover-title {
    text-align: center;
    padding: 16px 0 14px;
    border-bottom: 0.5px solid #e0e0e0;
    flex-shrink: 0;
  }
  .ct-kicker {
    font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase;
    color: #888; margin-bottom: 6px;
  }
  .ct-main {
    font-size: 19px; font-weight: 600; color: #1a1a1a;
    letter-spacing: 0.01em; margin-bottom: 4px;
  }
  .ct-ref {
    font-size: 10px; font-weight: 500; color: #444;
    font-family: 'Courier New', monospace; margin-bottom: 3px;
    letter-spacing: 0.05em;
  }
  .ct-sub  { font-size: 11px; color: #555; margin-bottom: 3px; }
  .ct-date { font-size: 10px; color: #888; }

  /* ── Sign-off grid ── */
  .signoff-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    margin-top: 4px;
  }
  .signoff {
    border: 0.5px solid #d0d0d0; border-radius: 3px; padding: 9px 12px;
  }
  .so-role {
    font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
    color: #888; font-weight: 700; margin-bottom: 4px;
  }
  .so-name {
    font-size: 12px; font-weight: 600; color: #1a1a1a; min-height: 16px;
  }
  .so-name.so-blank { color: #bbb; font-style: italic; }
  .so-meta {
    font-size: 9px; color: #666; margin-top: 5px;
    font-family: 'Courier New', monospace; line-height: 1.6;
  }
  .so-sig {
    margin-top: 8px; padding-top: 6px; border-top: 0.5px dashed #bbb;
    font-size: 9px; color: #999;
  }

  /* ── Cover sections ── */
  .cover-sections {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-evenly;
    padding: 8px 0 2px;
    gap: 0;
  }

  /* ── Info / cover blocks ── */
  .cover-block {
    border: 0.5px solid #d0d0d0; border-radius: 3px;
    padding: 8px 11px;
  }
  .cb-label {
    font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase;
    color: #888; margin-bottom: 6px; font-weight: 600;
  }
  .cover-grid {
    display: grid; grid-template-columns: 28mm 1fr 28mm 1fr;
    gap: 4px 14px; font-size: 10.5px; align-items: start;
  }
  .gk { color: #666; font-size: 9.5px; padding-top: 1px; }
  .gv { color: #1a1a1a; font-weight: 500; }
  ol.files-list { margin: 0; padding-left: 14px; }
  ol.files-list li { margin: 0; font-size: 10.5px; }

  /* ── Report metadata table (cover page) ── */
  .meta-table {
    width: 100%; border-collapse: collapse; font-size: 10.5px;
  }
  .meta-table tr { border-bottom: 0.5px solid #e0e0e0; }
  .meta-table tr:last-child { border-bottom: none; }
  .meta-table td { padding: 4px 8px 4px 0; vertical-align: top; }
  .mt-k {
    width: 38mm; color: #555; font-size: 9.5px; white-space: nowrap;
    padding-right: 10px; font-weight: 400;
  }
  .mt-v { color: #1a1a1a; font-weight: 500; }

  /* ── Tally row ── */
  .tally-row { display: flex; gap: 7px; margin-top: 8px; }
  .tally-cell {
    flex: 1; padding: 8px 5px 7px; border: 0.5px solid #d0d0d0;
    border-radius: 3px; text-align: center;
  }
  .tc-num {
    font-size: 24px; font-weight: 600; line-height: 1; margin-bottom: 4px;
    letter-spacing: -0.01em;
  }
  .tc-lbl { font-size: 8px; color: #777; letter-spacing: 0.08em; text-transform: uppercase; }
  .tc-block .tc-num { color: #A32D2D; }
  .tc-warn  .tc-num { color: #BA7517; }
  .tc-info  .tc-num { color: #185FA5; }
  .tc-score .tc-num { color: #1a1a1a; }
  .tc-rate  .tc-num { color: #4b5563; }

  /* ── Outcome verdict banner ── */
  .outcome-banner { padding: 9px 12px; border-radius: 3px; }
  .outcome-rejected { border: 1px solid #C0392B; background: #FEF6F6; }
  .outcome-approved { border: 1px solid #27500A; background: #F4FBF4; }
  .ob-label {
    font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase;
    font-weight: 700; margin-bottom: 4px;
  }
  .outcome-rejected .ob-label { color: #8B1A1A; }
  .outcome-approved .ob-label { color: #1E4009; }
  .ob-text { font-size: 12px; font-weight: 600; color: #1a1a1a; line-height: 1.4; }

  /* ── Section headings ── */
  .section-h {
    font-size: 11.5px; font-weight: 700; color: #1a1a1a;
    margin: 0 0 10px; padding-bottom: 4px;
    border-bottom: 1px solid #1a1a1a;
  }
  h2.section-top {
    font-size: 11.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em; color: #1a1a1a;
    margin: 0 0 8px; padding-bottom: 4px;
    border-bottom: 1.5px solid #1a1a1a;
  }
  h2.section-top .num { color: #888; margin-right: 5px; }
  h2.section-top + h2.section-top { margin-top: 14px; }

  /* ── Document summary inline ── */
  .doc-summary {
    margin-top: 7px; padding-top: 7px;
    border-top: 0.5px dashed #ccc;
    font-size: 10.5px; color: #333; line-height: 1.6;
  }
  .doc-summary b {
    font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase;
    font-weight: 700; color: #666; margin-right: 4px;
  }

  /* ── Doc meta block ── */
  .doc-meta-block { margin-bottom: 12px; }

  /* ── Findings header bar (standalone, not wrapping all cards) ── */
  .findings-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 11px;
    background: #f5f5f5;
    border: 0.5px solid #d0d0d0; border-radius: 2px 2px 2px 2px;
  }
  .fh-label { font-size: 10.5px; font-weight: 700; color: #1a1a1a; }
  .fh-badge { font-size: 8.5px; letter-spacing: 0.07em; text-transform: uppercase; font-weight: 700; }
  .fh-badge-reject { color: #8B1A1A; }
  .fh-badge-warn   { color: #7A4B0A; }
  .fh-badge-pass   { color: #1E4009; }

  /* ── Evaluation head grouping ── */
  .eval-head-section {
    margin-top: 14px;
  }
  .eval-head-title {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 11px;
    background: #f0f0f0;
    border: 0.5px solid #c0c0c0; border-radius: 3px 3px 3px 3px;
    page-break-after: avoid;
    break-after: avoid;
  }
  .eh-name {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: #1a1a1a; flex: 1;
  }
  .eh-chips { display: flex; gap: 5px; flex-shrink: 0; }
  .eh-chip {
    font-size: 7.5px; font-weight: 700; letter-spacing: 0.06em;
    padding: 1px 6px; border-radius: 2px;
  }
  .eh-chip-block { background: #A32D2D; color: #fff; }
  .eh-chip-warn  { background: #BA7517; color: #fff; }
  .eh-chip-info  { background: #185FA5; color: #fff; }

  /* first card inside a group connects flush to the heading bar */
  .eval-head-section .finding-card:first-of-type {
    border-radius: 0 0 3px 3px;
    border-top: none;
    margin-top: 0;
  }

  /* ── Individual finding card — each is its own bordered box ── */
  .finding-card {
    border: 0.5px solid #d0d0d0;
    border-radius: 3px;
    padding: 9px 11px;
    margin-top: 7px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .fr-top {
    display: flex; gap: 7px; align-items: center;
    font-size: 8.5px; margin-bottom: 4px;
    font-family: 'Courier New', monospace; color: #666;
  }
  .fr-sev {
    font-weight: 700; padding: 1px 5px; border-radius: 2px;
    letter-spacing: 0.07em; font-size: 8px; white-space: nowrap;
  }
  .fr-sev.sev-block { background: #A32D2D; color: #fff; }
  .fr-sev.sev-warn  { background: #BA7517; color: #fff; }
  .fr-sev.sev-info  { background: #185FA5; color: #fff; }
  .fr-ref { color: #888; }

  .fr-issue    { font-size: 10.5px; font-weight: 700; color: #1a1a1a; line-height: 1.4; margin-bottom: 4px; }
  .fr-location { font-size: 9px; font-family: 'Courier New', monospace; color: #888; margin-bottom: 3px; }
  .fr-detail   { font-size: 10px; color: #444; line-height: 1.6; margin-bottom: 4px; }
  .fr-action-line {
    font-size: 10px; color: #1a1a1a; margin-top: 5px;
    padding: 5px 9px; background: #f5f8fc;
    border-left: 2.5px solid #185FA5; border-radius: 0 2px 2px 0;
    line-height: 1.5;
  }
  .fr-action-line b { font-weight: 700; color: #0C447C; }

  p.empty {
    color: #888; font-style: italic; font-size: 10px;
    padding: 9px 11px;
    border: 0.5px solid #d0d0d0; border-radius: 3px;
    margin-top: 7px;
  }

  /* ── Summary table ── */
  table.summary {
    width: 100%; border-collapse: collapse;
    margin: 6px 0 10px; font-size: 10px;
  }
  table.summary th, table.summary td {
    padding: 5px 9px; border: 0.5px solid #d8d8d8;
    text-align: left; vertical-align: middle;
  }
  table.summary thead th {
    background: #f4f4f4; color: #333;
    text-transform: uppercase; letter-spacing: 0.07em;
    font-size: 8px; font-weight: 700;
  }
  table.summary td.value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
  table.summary tr.total td { border-top: 1px solid #1a1a1a; font-weight: 700; }

  /* ── Body prose ── */
  p.body-text {
    font-size: 10.5px; color: #333; line-height: 1.65;
    margin-bottom: 8px; text-align: justify;
  }

  /* ── Footer ── */
  .pdf-ftr {
    padding: 5px 18px; border-top: 0.5px solid #d0d0d0;
    display: flex; justify-content: space-between;
    font-size: 8px; color: #888;
    font-family: 'Courier New', monospace;
    margin-top: 12px;
  }

  /* ─── PRINT ─── */
  @media print {
    html, body { background: #fff; }

    /* Cover page: treat as single printed page */
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
    /* Cover body stretches to fill the page */
    .page-cover .pdf-body {
      flex: 1;
    }

    /* Flow pages: no forced page break, let browser flow naturally */
    .page-flow {
      width: 100% !important;
      margin: 0 !important;
      box-shadow: none !important;
    }
    /* Exec summary always starts fresh after cover */
    .page-cover + .page-flow {
      page-break-before: always;
      break-before: page;
    }
    .page-flow + .page-flow {
      border-top: none;
    }

    /* Each finding card must not be split across pages */
    .finding-card {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    /* Keep the header bar with its first card */
    .findings-header {
      page-break-after: avoid;
      break-after: avoid;
    }

    /* Section headings should not be orphaned */
    .section-h, h2.section-top {
      page-break-after: avoid;
      break-after: avoid;
    }

    /* Doc meta block shouldn't split */
    .doc-meta-block {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
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
  const suggestionCount = allIssues.filter((i) => i.severity === "suggestion").length;
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
    errorCount, warningCount, suggestionCount,
    orgName, orgSub,
  );

  /* Page 2 — Executive summary + methodology (flows into doc detail) */
  const execPage = `
  <div class="page-flow">
    ${letterheadHdr(orgName, orgSub, "AI Review Audit Pack", "Executive Summary & Methodology")}
    <div class="pdf-body">

      <h2 class="section-top"><span class="num">1.</span>Executive Summary</h2>
      <p class="body-text">
        This report presents the findings of an AI-assisted review of
        ${totalDocs} document${totalDocs !== 1 ? "s" : ""} submitted on
        ${escapeHtml(formatDate(generatedAt))}. The analysis identified
        ${allIssues.length} finding${allIssues.length !== 1 ? "s" : ""}
        comprising ${errorCount} blocking error${errorCount !== 1 ? "s" : ""},
        ${warningCount} warning${warningCount !== 1 ? "s" : ""}, and
        ${suggestionCount} suggestion${suggestionCount !== 1 ? "s" : ""}.
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
            <td>Errors — blocking, must be resolved</td>
            <td class="value">${errorCount}</td>
            <td class="value">${allIssues.length ? Math.round((errorCount / allIssues.length) * 100) : 0}%</td>
          </tr>
          <tr>
            <td>Warnings — should be addressed</td>
            <td class="value">${warningCount}</td>
            <td class="value">${allIssues.length ? Math.round((warningCount / allIssues.length) * 100) : 0}%</td>
          </tr>
          <tr>
            <td>Suggestions — recommended improvements</td>
            <td class="value">${suggestionCount}</td>
            <td class="value">${allIssues.length ? Math.round((suggestionCount / allIssues.length) * 100) : 0}%</td>
          </tr>
          <tr class="total">
            <td><strong>Total Findings</strong></td>
            <td class="value">${allIssues.length}</td>
            <td class="value">—</td>
          </tr>
        </tbody>
      </table>

      <h2 class="section-top" style="margin-top:12px;"><span class="num">2.</span>Scope &amp; Methodology</h2>
      <p class="body-text">
        The submitted document${totalDocs !== 1 ? "s were" : " was"} processed by
        the ${escapeHtml(meta.model ?? "configured AI")} large-language model and evaluated
        against completeness of required fields, formatting and structural consistency,
        regulatory references, date and identifier conventions, and the presence of factual
        or compliance gaps. Findings are graded: <strong>Block</strong> (acceptance-blocking),
        <strong>Warn</strong> (should be remediated before submission), and
        <strong>Info</strong> (recommended improvement). Quality score: 100 = ready to submit.
      </p>

    </div>
    ${letterheadFtr(`${orgName} · AI Review Audit Pack · ${reportRef}`, "Page 2")}
  </div>`;

  /* Pages 3+ — per-document detail */
  const docPages = result.documents
    .map((doc, idx) =>
      buildDocSection(doc, idx, totalDocs, orgName, orgSub, reportRef, idx + 3, meta.metadata?.[idx])
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>AI Review Audit Pack — ${escapeHtml(reportRef)}</title>
<style>${CSS}</style>
</head>
<body>
  ${coverPage}
  ${execPage}
  ${docPages}
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