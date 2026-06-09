/*
 * LIMS Review — MS SQL Server schema
 * --------------------------------------------------------------
 * Tables:
 *   LimsHeads               (lookup of evaluation categories)
 *   LimsReviews             (one row per review run)
 *   LimsReviewDocuments     (one row per PDF in a review)
 *   LimsReviewFindings      (each issue/finding, categorised by head)
 *   LimsFindingActions      (audit log of accept / modify / reject decisions)
 *
 * Connection string is intentionally NOT included — wire it up via your
 * backend configuration.
 *
 * File storage:
 *   PDFs are written to disk by the backend (e.g. C:\LimsReviewStorage\<reviewId>\<filename>.pdf).
 *   Only the relative storage path is persisted in LimsReviewDocuments.StoragePath.
 * --------------------------------------------------------------
 */

SET NOCOUNT ON;
GO

-- ============================================================
-- 0.  Drop in reverse-dependency order if re-running on a dev DB.
--     Comment these out for production deployments.
-- ============================================================
IF OBJECT_ID('dbo.vLimsFindingLatestAction', 'V') IS NOT NULL DROP VIEW dbo.vLimsFindingLatestAction;
IF OBJECT_ID('dbo.LimsFindingActions',  'U') IS NOT NULL DROP TABLE dbo.LimsFindingActions;
IF OBJECT_ID('dbo.LimsReviewFindings',  'U') IS NOT NULL DROP TABLE dbo.LimsReviewFindings;
IF OBJECT_ID('dbo.LimsReviewDocuments', 'U') IS NOT NULL DROP TABLE dbo.LimsReviewDocuments;
IF OBJECT_ID('dbo.LimsReviews',         'U') IS NOT NULL DROP TABLE dbo.LimsReviews;
IF OBJECT_ID('dbo.LimsHeads',           'U') IS NOT NULL DROP TABLE dbo.LimsHeads;
GO

-- ============================================================
-- 1.  Lookup: evaluation heads (categories)
-- ============================================================
CREATE TABLE dbo.LimsHeads (
    HeadId       INT             NOT NULL PRIMARY KEY,
    HeadCode     NVARCHAR(32)    NOT NULL UNIQUE,
    HeadName     NVARCHAR(128)   NOT NULL,
    Description  NVARCHAR(500)   NULL,
    OrderIndex   INT             NOT NULL,
    IsActive     BIT             NOT NULL CONSTRAINT DF_LimsHeads_Active DEFAULT(1)
);
GO

INSERT INTO dbo.LimsHeads (HeadId, HeadCode, HeadName, Description, OrderIndex) VALUES
    (1, 'IDENTITY',   'Identity & document integrity', 'ULR, report number, document IDs, structural completeness',     1),
    (2, 'DATES',      'Date & workflow logic',         'Mfg/issue/analysis/sampling date sequencing and consistency',   2),
    (3, 'PARAMS',     'Inter-parameter conflicts',     'Method/LOQ/UOM consistency, value drift across versions',       3),
    (4, 'MATRIX',     'Matrix-parameter',              'Matrix vs parameter applicability and method scope',            4),
    (5, 'REGULATORY', 'Regulatory & method',           'Regulatory code references, method versioning, FSSAI/etc.',     5),
    (6, 'HYGIENE',    'Signatory & hygiene',           'Signatures, stamps, formatting, language and presentation',     6);
GO

-- ============================================================
-- 2.  Reviews
-- ============================================================
CREATE TABLE dbo.LimsReviews (
    ReviewId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_LimsReviews PRIMARY KEY CONSTRAINT DF_LimsReviews_Id DEFAULT(NEWID()),
    CorrelationId    NVARCHAR(64)     NOT NULL,
    Model            NVARCHAR(128)    NULL,
    OverallScore     INT              NOT NULL CONSTRAINT CK_LimsReviews_Score CHECK (OverallScore BETWEEN 0 AND 100),
    Status           NVARCHAR(32)     NOT NULL CONSTRAINT DF_LimsReviews_Status DEFAULT('open')
                                         CONSTRAINT CK_LimsReviews_Status CHECK (Status IN ('open','in_review','approved','rejected','archived')),
    InputTokens      INT              NULL,
    OutputTokens     INT              NULL,
    ReviewedAt       DATETIME2(0)     NOT NULL,
    CreatedAt        DATETIME2(0)     NOT NULL CONSTRAINT DF_LimsReviews_Created DEFAULT(SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(0)     NOT NULL CONSTRAINT DF_LimsReviews_Updated DEFAULT(SYSUTCDATETIME()),
    CreatedBy        NVARCHAR(128)    NULL,
    ApprovedBy       NVARCHAR(128)    NULL,
    ApprovedAt       DATETIME2(0)     NULL
);
GO

CREATE INDEX IX_LimsReviews_CreatedAt    ON dbo.LimsReviews(CreatedAt DESC);
CREATE INDEX IX_LimsReviews_Status       ON dbo.LimsReviews(Status, CreatedAt DESC);
CREATE INDEX IX_LimsReviews_Correlation  ON dbo.LimsReviews(CorrelationId);
GO

-- ============================================================
-- 3.  Documents (each PDF in a review)
-- ============================================================
CREATE TABLE dbo.LimsReviewDocuments (
    DocumentId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_LimsReviewDocuments PRIMARY KEY CONSTRAINT DF_LimsReviewDocuments_Id DEFAULT(NEWID()),
    ReviewId         UNIQUEIDENTIFIER NOT NULL,
    FileName         NVARCHAR(512)    NOT NULL,
    FileSizeBytes    BIGINT           NOT NULL,
    ContentType      NVARCHAR(128)    NOT NULL CONSTRAINT DF_LimsReviewDocuments_Mime DEFAULT('application/pdf'),
    StoragePath      NVARCHAR(1024)   NOT NULL,   -- e.g. 'reviews\\<reviewId>\\<docId>.pdf'  (resolved against backend FileStorage root)
    Sha256Hex        CHAR(64)         NULL,        -- file integrity hash
    OrderIndex       INT              NOT NULL CONSTRAINT DF_LimsReviewDocuments_Order DEFAULT(0),
    Score            INT              NOT NULL CONSTRAINT CK_LimsReviewDocuments_Score CHECK (Score BETWEEN 0 AND 100),
    Summary          NVARCHAR(MAX)    NULL,
    CreatedAt        DATETIME2(0)     NOT NULL CONSTRAINT DF_LimsReviewDocuments_Created DEFAULT(SYSUTCDATETIME()),
    CONSTRAINT FK_LimsReviewDocuments_Review FOREIGN KEY (ReviewId) REFERENCES dbo.LimsReviews(ReviewId) ON DELETE CASCADE
);
GO

CREATE INDEX IX_LimsReviewDocuments_Review ON dbo.LimsReviewDocuments(ReviewId, OrderIndex);
GO

-- ============================================================
-- 4.  Findings (categorised per head)
-- ============================================================
CREATE TABLE dbo.LimsReviewFindings (
    FindingId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_LimsReviewFindings PRIMARY KEY CONSTRAINT DF_LimsReviewFindings_Id DEFAULT(NEWID()),
    DocumentId       UNIQUEIDENTIFIER NOT NULL,
    HeadId           INT              NOT NULL,
    Severity         NVARCHAR(16)     NOT NULL CONSTRAINT CK_LimsReviewFindings_Severity CHECK (Severity IN ('error','warning','suggestion')),
    Title            NVARCHAR(500)    NOT NULL,
    Description      NVARCHAR(MAX)    NULL,
    Location         NVARCHAR(500)    NULL,
    PageNumber       INT              NULL,
    Suggestion       NVARCHAR(MAX)    NULL,
    -- Evidence pack (mirrors the side-panel design):
    --   {
    --     "compared": [{ "label": "Alpha DL", "old": "0.006 Bq/L", "new": "0.007 Bq/L" }],
    --     "verdict":  "DL changed without analysis-date change",
    --     "rule":     { "code": "R-AMEND4", "version": "v1.0" },
    --     "trace":    [{ "tag": "DET 1", "text": "..." }, { "tag": "LLM", "text": "..." }]
    --   }
    Evidence         NVARCHAR(MAX)    NULL,   -- JSON; SQL Server validates via ISJSON below
    RuleCode         NVARCHAR(64)     NULL,
    RuleVersion      NVARCHAR(32)     NULL,
    OrderIndex       INT              NOT NULL CONSTRAINT DF_LimsReviewFindings_Order DEFAULT(0),
    CreatedAt        DATETIME2(0)     NOT NULL CONSTRAINT DF_LimsReviewFindings_Created DEFAULT(SYSUTCDATETIME()),
    CONSTRAINT FK_LimsReviewFindings_Document FOREIGN KEY (DocumentId) REFERENCES dbo.LimsReviewDocuments(DocumentId) ON DELETE CASCADE,
    CONSTRAINT FK_LimsReviewFindings_Head     FOREIGN KEY (HeadId)     REFERENCES dbo.LimsHeads(HeadId),
    CONSTRAINT CK_LimsReviewFindings_Evidence CHECK (Evidence IS NULL OR ISJSON(Evidence) = 1)
);
GO

CREATE INDEX IX_LimsReviewFindings_Document ON dbo.LimsReviewFindings(DocumentId, OrderIndex);
CREATE INDEX IX_LimsReviewFindings_Head     ON dbo.LimsReviewFindings(HeadId);
CREATE INDEX IX_LimsReviewFindings_Severity ON dbo.LimsReviewFindings(Severity);
GO

-- ============================================================
-- 5.  Action audit log (one row per state change — full history)
-- ============================================================
CREATE TABLE dbo.LimsFindingActions (
    ActionId         BIGINT           IDENTITY(1,1) NOT NULL CONSTRAINT PK_LimsFindingActions PRIMARY KEY,
    FindingId        UNIQUEIDENTIFIER NOT NULL,
    Action           NVARCHAR(32)     NOT NULL CONSTRAINT CK_LimsFindingActions_Action CHECK (Action IN ('pending','accepted','modified','rejected')),
    Note             NVARCHAR(MAX)    NULL,
    ModifiedBody     NVARCHAR(MAX)    NULL,   -- for "modified" action: the corrective note / amended text
    ActedBy          NVARCHAR(128)    NULL,
    ActedAt          DATETIME2(0)     NOT NULL CONSTRAINT DF_LimsFindingActions_ActedAt DEFAULT(SYSUTCDATETIME()),
    CONSTRAINT FK_LimsFindingActions_Finding FOREIGN KEY (FindingId) REFERENCES dbo.LimsReviewFindings(FindingId) ON DELETE CASCADE
);
GO

CREATE INDEX IX_LimsFindingActions_Finding ON dbo.LimsFindingActions(FindingId, ActedAt DESC);
GO

-- ============================================================
-- 6.  View: latest action per finding (for fast read in lists)
-- ============================================================
CREATE VIEW dbo.vLimsFindingLatestAction AS
WITH latest AS (
    SELECT
        FindingId,
        Action,
        Note,
        ModifiedBody,
        ActedBy,
        ActedAt,
        ROW_NUMBER() OVER (PARTITION BY FindingId ORDER BY ActedAt DESC, ActionId DESC) AS rn
    FROM dbo.LimsFindingActions
)
SELECT FindingId, Action, Note, ModifiedBody, ActedBy, ActedAt
FROM latest
WHERE rn = 1;
GO

PRINT 'LIMS Review schema created.';
GO
