# LIMS Review — Backend API Contract

The frontend currently caches reviews in IndexedDB. To move to durable storage,
implement the endpoints below on the .NET backend. The schema for the
underlying tables is in [`sql/01_schema.sql`](../sql/01_schema.sql).

All endpoints return `application/json` unless noted. Errors follow the same
shape used by `POST /api/pdf-review/process`:

```json
{
  "correlationId": "…",
  "success": false,
  "errorCode": "VALIDATION_ERROR" | "NOT_FOUND" | "INTERNAL_ERROR" | …,
  "message": "human-readable explanation"
}
```

## File storage

- Configure a root directory in the backend (e.g. `appsettings.json` →
  `FileStorage:Root = "C:\\LimsReviewStorage"`).
- For every saved review, write each PDF to
  `<Root>\reviews\<reviewId>\<documentId>.pdf`.
- Persist that relative path (`reviews\<reviewId>\<documentId>.pdf`) in
  `LimsReviewDocuments.StoragePath`.
- The `GET …/pdf/{documentId}` endpoint streams the file back to the browser
  with `Content-Type: application/pdf` and a `Content-Disposition: inline`
  header so the PDF viewer can render it.

---

## Reviews

### `POST /api/reviews`

Create a new review record from a successful AI run. Called by the frontend
**after** `/api/pdf-review/process` has returned successfully.

`multipart/form-data` fields:

| field            | type     | notes |
|------------------|----------|-------|
| `files`          | file[]   | The same PDFs that were just reviewed. Streamed to `FileStorage`. |
| `result`         | text     | JSON-stringified `ReviewResult` (see `src/types/ReviewResult.ts`). |
| `correlationId`  | text     | From the AI response. |
| `model`          | text     | From the AI response. |
| `inputTokens`    | text     | Optional. |
| `outputTokens`   | text     | Optional. |

Response `200`:

```json
{
  "reviewId": "uuid",
  "createdAt": "2026-05-12T08:00:00Z",
  "documents": [
    { "documentId": "uuid", "fileName": "report1.pdf", "sizeBytes": 524288 }
  ]
}
```

The server is responsible for inserting into `LimsReviews`,
`LimsReviewDocuments`, and `LimsReviewFindings` (one row per finding, including
`HeadId` resolved from `Issue.headCode` and `Evidence` stored as the raw JSON
fragment).

### `GET /api/reviews`

List recent reviews, newest first. Query string:

- `take` (default 25, max 100)
- `skip` (default 0)
- `status` (optional filter: `open | in_review | approved | rejected | archived`)

Response:

```json
{
  "items": [
    {
      "reviewId": "uuid",
      "correlationId": "…",
      "createdAt": "2026-05-12T08:00:00Z",
      "model": "claude-sonnet-4-6",
      "overallScore": 62,
      "status": "open",
      "fileCount": 1,
      "totalSizeBytes": 524288,
      "fileNames": ["report1.pdf"],
      "errorCount": 3,
      "warningCount": 3,
      "suggestionCount": 2
    }
  ],
  "total": 14
}
```

### `GET /api/reviews/{reviewId}`

Return the full review including documents, findings (with head and evidence),
and the latest action per finding.

```json
{
  "reviewId": "uuid",
  "correlationId": "…",
  "model": "claude-sonnet-4-6",
  "overallScore": 62,
  "status": "open",
  "reviewedAt": "2026-05-12T08:00:00Z",
  "createdAt": "2026-05-12T08:00:00Z",
  "documents": [
    {
      "documentId": "uuid",
      "fileName": "report1.pdf",
      "sizeBytes": 524288,
      "score": 62,
      "summary": "…",
      "findings": [
        {
          "findingId": "uuid",
          "headCode": "DATES",
          "severity": "error",
          "title": "Analysis completion before sampling date",
          "description": "…",
          "location": "Page 1 — Sample Analysis Details",
          "page": 1,
          "suggestion": "…",
          "evidence": {
            "compared": [
              { "label": "Sampling",  "old": null, "new": "26/09/2025" },
              { "label": "Analysis",  "old": null, "new": "16/02/2026" }
            ],
            "verdict": "Analysis predates sampling",
            "rule": { "code": "R-DATE-01", "version": "v1.0" }
          },
          "currentAction": {
            "action": "pending",
            "note": null,
            "actedBy": null,
            "actedAt": null
          }
        }
      ]
    }
  ]
}
```

### `GET /api/reviews/{reviewId}/pdf/{documentId}`

Stream the original PDF. The frontend opens the returned blob URL in
`<PdfViewer>` exactly as it does today with the IndexedDB blob.

### `DELETE /api/reviews/{reviewId}`

Delete the review row (cascades to documents/findings/actions) **and** remove
the files from disk. Returns `204`.

### `PATCH /api/reviews/{reviewId}/status`

```json
{ "status": "approved" | "rejected" | "archived", "note": "optional" }
```

The backend also stamps `ApprovedBy`/`ApprovedAt` when transitioning to
`approved`.

---

## Finding actions

### `POST /api/findings/{findingId}/actions`

Record an analyst's decision. Append-only — every state change writes a new row
into `LimsFindingActions`, so the audit trail is preserved.

```json
{
  "action": "accepted" | "modified" | "rejected" | "pending",
  "note": "optional reviewer comment",
  "modifiedBody": "optional corrective text when action = modified",
  "actedBy": "user@efrac.org"
}
```

Response: the newly written action row, plus the updated `currentAction` view
for the finding.

### `GET /api/findings/{findingId}/actions`

Full history of decisions on a single finding (newest first). Used by the
"history" drawer on a finding card.

---

## Migration plan (frontend)

1. The frontend's `reviewHistoryStore` (IndexedDB) is the temporary store.
2. Implement the endpoints above on the backend.
3. Swap the import in `App.tsx` and `UploadPage.tsx` from
   `services/reviewHistoryStore` to `services/reviewApi` (stub already in place
   at [`src/services/reviewApi.ts`](../src/services/reviewApi.ts)).
4. After save in `PreviewPage.tsx`, call `reviewApi.saveReview(...)` instead of
   the IndexedDB `saveReview`. Pass the same files + the AI response.
5. Recent Reviews list now reads from `reviewApi.listReviewMetas()`.
6. Opening a stored review calls `reviewApi.getReview(id)`; the PDF for each
   document is fetched from `reviewApi.pdfUrl(reviewId, documentId)` (a plain
   URL the browser can hand straight to `PdfViewer`).
7. Action button handlers call `reviewApi.recordAction(findingId, …)` after
   updating local state.
