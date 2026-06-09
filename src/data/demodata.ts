import type { ReviewResult } from "../types/ReviewResult";

const ISSUE_SETS = [
  {
    score: 68,
    summary:
      "Several critical compliance issues detected. Missing mandatory fields and date formatting inconsistencies require immediate attention before submission.",
    issues: [
      {
        severity: "error" as const,
        title: "Missing Signature Block",
        description:
          "The document lacks the mandatory authorized signature block on the final page. All official submissions require a valid signature with date, name, and designation clearly printed.",
        location: "Page 3 — Section 5.2: Authorization",
        suggestion:
          "Add a signature block containing: Authorized Name, Designation, Date of Signing, and an Official Stamp. Place it in the bottom third of the last page.",
        page: 3,
      },
      {
        severity: "error" as const,
        title: "Non-Compliant Date Formatting",
        description:
          "Dates throughout the document use mixed formats (MM/DD/YYYY and DD-MM-YYYY). The required standard is ISO 8601 (YYYY-MM-DD) for all date fields.",
        location: "Pages 1, 4, 7 — 6 occurrences found",
        suggestion:
          "Standardize all 6 date occurrences to YYYY-MM-DD. Use a find-and-replace approach to ensure nothing is missed.",
        page: 1,
      },
      {
        severity: "warning" as const,
        title: "Incomplete Secondary Contact",
        description:
          "The contact section contains only primary contact details. Secondary contact information is required per Section 2.1 of the submission guidelines.",
        location: "Page 2 — Section 2.1: Contact Details",
        suggestion:
          "Complete the secondary contact fields: name, phone, email, and department. This is required for audit trail purposes.",
        page: 2,
      },
      {
        severity: "warning" as const,
        title: "Inconsistent Font Usage",
        description:
          "Body text alternates between Times New Roman (12pt) and Arial (11pt). Corporate style guidelines require a single, consistent typeface throughout.",
        location: "Sections 3, 4, and 6 — Body paragraphs",
        suggestion:
          "Unify all body text to Arial 11pt. Check headers separately — they should use Arial Bold 13pt per the style guide.",
        page: 3,
      },
      {
        severity: "suggestion" as const,
        title: "Strengthen Executive Summary",
        description:
          "The executive summary lacks quantified outcomes and KPIs. Reviewers expect metrics-driven summaries for faster decision-making.",
        location: "Page 1 — Section 1: Executive Summary",
        suggestion:
          "Include 2–3 key metrics, a timeline summary, and a clear ROI or outcome statement within the first paragraph.",
        page: 1,
      },
      {
        severity: "suggestion" as const,
        title: "Add a Table of Contents",
        description:
          "Documents exceeding 5 pages should include a navigational table of contents for reviewers and auditors.",
        location: "After cover page",
        suggestion:
          "Insert an auto-generated TOC after the cover page. Ensure all major section headings are included with accurate page numbers.",
      },
    ],
  },
  {
    score: 84,
    summary:
      "Document is largely well-structured with minor formatting inconsistencies. A few optional fields are incomplete but no critical errors were detected.",
    issues: [
      {
        severity: "warning" as const,
        title: "Logo Resolution Too Low",
        description:
          "The organization logo on the cover page is below 150 DPI, which will appear pixelated in print. Digital submissions still benefit from sharp assets.",
        location: "Page 1 — Cover Page Header",
        suggestion:
          "Replace the logo with a vector SVG or a high-resolution PNG (minimum 300 DPI at display size).",
        page: 1,
      },
      {
        severity: "warning" as const,
        title: "Heading Hierarchy Skipped",
        description:
          "Section 4.3 jumps from H2 directly to H4, skipping H3. This breaks the document's logical hierarchy and can cause issues with auto-generated TOCs.",
        location: "Page 6 — Section 4.3",
        suggestion:
          "Insert an H3 heading between the H2 and H4 levels. Review the full document to check for other hierarchy skips.",
        page: 6,
      },
      {
        severity: "suggestion" as const,
        title: "References Section Missing",
        description:
          "Three external statistics cited in Section 5 have no corresponding reference entries. This reduces the document's credibility.",
        location: "Page 8 — Section 5: Market Analysis",
        suggestion:
          "Add a References section at the end listing all cited sources in APA or ISO 690 format.",
        page: 8,
      },
    ],
  },
  {
    score: 55,
    summary:
      "Multiple critical errors found. Document requires significant revisions before it can be accepted. Core sections are either missing or incomplete.",
    issues: [
      {
        severity: "error" as const,
        title: "Section 3 Completely Missing",
        description:
          "Section 3 (Financial Summary) is referenced in the Table of Contents but the actual content is absent from the document body.",
        location: "Expected at Page 4 — Section 3: Financial Summary",
        suggestion:
          "Add the complete financial summary section including budget breakdown, expenditure to date, and projected costs.",
        page: 4,
      },
      {
        severity: "error" as const,
        title: "Invalid File References",
        description:
          "Annex B is referenced twice in the document body but is not attached. This will cause rejection during automated validation.",
        location: "Pages 5 and 9 — References to Annex B",
        suggestion:
          "Attach Annex B or remove all references to it. If intentionally excluded, note its absence with a reason in the appendix.",
        page: 5,
      },
      {
        severity: "error" as const,
        title: "Regulatory Code Out of Date",
        description:
          "The document references regulatory code REG-2019-47 which was superseded by REG-2023-12 in March 2023. Use of outdated codes may invalidate the submission.",
        location: "Page 2 — Section 1.4: Regulatory Framework",
        suggestion:
          "Replace all instances of REG-2019-47 with REG-2023-12 and verify that the associated compliance requirements still apply.",
        page: 2,
      },
      {
        severity: "warning" as const,
        title: "Page Numbering Restart Detected",
        description:
          "Page numbering resets to 1 after page 7, suggesting sections were assembled from different source documents without normalization.",
        location: "Page 8 onwards",
        suggestion:
          "Fix the page numbering to run continuously from 1 to the final page. Update the Table of Contents to reflect corrected numbers.",
        page: 8,
      },
      {
        severity: "suggestion" as const,
        title: "Consider Adding Visual Aids",
        description:
          "Sections 4 and 5 contain dense text with complex data relationships. Charts or diagrams would significantly improve comprehension.",
        location: "Pages 6–9 — Sections 4 and 5",
        suggestion:
          "Add 1–2 charts or tables to visualize the key data points. Ensure all visuals have captions and are referenced in the text.",
        page: 6,
      },
    ],
  },
  {
    score: 91,
    summary:
      "Excellent document quality with only minor suggestions for improvement. Ready for submission with optional enhancements recommended.",
    issues: [
      {
        severity: "suggestion" as const,
        title: "Add Version Control Footer",
        description:
          "The document lacks a version number and revision date in the footer. This is a best practice for collaborative documents.",
        location: "All pages — Footer area",
        suggestion:
          "Add a footer with document version (e.g. v1.2), revision date, and author initials on every page.",
      },
      {
        severity: "suggestion" as const,
        title: "Glossary Would Aid Reviewers",
        description:
          "Several domain-specific acronyms are used without definition. A glossary improves accessibility for external reviewers.",
        location: "Throughout document — acronyms: CAGR, EBITDA, KYC",
        suggestion:
          "Add a Glossary appendix defining all technical acronyms. Alternatively, expand acronyms on first use.",
      },
    ],
  },
  {
    score: 73,
    summary:
      "Document structure is acceptable but contains notable formatting issues and a few missing required elements that should be corrected.",
    issues: [
      {
        severity: "error" as const,
        title: "Unsigned Declaration Form",
        description:
          "The statutory declaration on page 5 must be manually signed. A printed name alone does not satisfy the legal requirement.",
        location: "Page 5 — Statutory Declaration",
        suggestion:
          "Obtain a wet signature or qualified electronic signature (eIDAS compliant) on the declaration before resubmitting.",
        page: 5,
      },
      {
        severity: "warning" as const,
        title: "Images Without Alt Text",
        description:
          "4 images in the document have no descriptive alt text or captions, reducing accessibility and compliance with WCAG 2.1 AA.",
        location: "Pages 3, 6, 8, 10 — Embedded images",
        suggestion:
          "Add meaningful captions below each image and descriptive alt text in the document properties for each figure.",
        page: 3,
      },
      {
        severity: "warning" as const,
        title: "Footer Differs Across Sections",
        description:
          "Sections 1–3 use a different footer style than Sections 4–7, indicating the document was merged from multiple templates.",
        location: "All pages — Footer",
        suggestion:
          "Standardize the footer across all pages to use the same style, font, and content format.",
      },
      {
        severity: "suggestion" as const,
        title: "Improve Conclusion Section",
        description:
          "The conclusion is only 2 sentences and doesn't recap the key findings or next steps clearly.",
        location: "Last page — Conclusion",
        suggestion:
          "Expand the conclusion to 1–2 paragraphs covering: key findings, recommended actions, and timeline for next steps.",
      },
    ],
  },
];

export const generateDemoReview = (fileIds: { id: string; name: string }[]): ReviewResult => {
  const documents = fileIds.map((f, idx) => {
    const set = ISSUE_SETS[idx % ISSUE_SETS.length];
    return {
      fileName: f.name,
      fileId: f.id,
      score: set.score,
      summary: set.summary,
      issues: set.issues.map((issue, i) => ({ ...issue, id: `${f.id}-issue-${i}` })),
    };
  });

  return {
    documents,
    overallScore: Math.round(documents.reduce((s, d) => s + d.score, 0) / documents.length),
    reviewedAt: new Date().toISOString(),
  };
};