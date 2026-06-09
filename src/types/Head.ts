/**
 * Evaluation heads (categories) — kept in sync with the LimsHeads table.
 * If you add a head here, also add it in sql/01_schema.sql.
 */

export type HeadCode =
  | "IDENTITY"
  | "DATES"
  | "PARAMS"
  | "MATRIX"
  | "REGULATORY"
  | "HYGIENE";

export interface Head {
  id: number;
  code: HeadCode;
  name: string;
  description: string;
}

export const HEADS: readonly Head[] = [
  { id: 1, code: "IDENTITY",   name: "Identity & document integrity", description: "ULR, report number, structural completeness." },
  { id: 2, code: "DATES",      name: "Date & workflow logic",         description: "Issue / analysis / sampling date consistency." },
  { id: 3, code: "PARAMS",     name: "Inter-parameter conflicts",     description: "Method, LOQ, UOM consistency and value drift." },
  { id: 4, code: "MATRIX",     name: "Matrix-parameter",              description: "Matrix vs parameter applicability and scope." },
  { id: 5, code: "REGULATORY", name: "Regulatory & method",           description: "Regulatory references, method versioning." },
  { id: 6, code: "HYGIENE",    name: "Signatory & hygiene",           description: "Signatures, stamps, formatting, language." },
] as const;

export const HEAD_BY_CODE: Record<HeadCode, Head> =
  HEADS.reduce((m, h) => { m[h.code] = h; return m; }, {} as Record<HeadCode, Head>);

export function isHeadCode(value: unknown): value is HeadCode {
  return typeof value === "string" && value in HEAD_BY_CODE;
}
