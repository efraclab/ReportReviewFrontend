// ─── AppContext.tsx ───────────────────────────────────────────────────────────
// Shared cross-route state so pages can read/write files, review results, and
// the reg-no bundle without prop-drilling through the router.

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { ReviewResult }    from "./types/ReviewResult";
import type { ReportMetadata }  from "./services/pdfReviewClient";
import type { UploadedFile }    from "./types/UploadedFile";
import type { RegNoReviewBundle } from "./services/regNoReviewClient";

interface AppState {
  // ── PDF flow ────────────────────────────────────────────────
  files:         UploadedFile[];
  result:        ReviewResult | null;
  metadata:      ReportMetadata[] | undefined;
  correlationId: string | undefined;
  model:         string | undefined;

  // ── Reg-no flow ─────────────────────────────────────────────
  regNoBundle:   RegNoReviewBundle | null;
}

interface AppContextValue extends AppState {
  setFiles:         (f: UploadedFile[]) => void;
  setReviewResult:  (r: ReviewResult, meta: ReportMetadata[], cid: string, mdl: string) => void;
  setRegNoBundle:   (b: RegNoReviewBundle) => void;
  /** Revokes object-URLs and clears all transient state. */
  clearAll:         () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [files,         setFilesRaw]  = useState<UploadedFile[]>([]);
  const [result,        setResult]    = useState<ReviewResult | null>(null);
  const [metadata,      setMetadata]  = useState<ReportMetadata[] | undefined>(undefined);
  const [correlationId, setCorrId]    = useState<string | undefined>(undefined);
  const [model,         setModel]     = useState<string | undefined>(undefined);
  const [regNoBundle,   setBundle]    = useState<RegNoReviewBundle | null>(null);

  const setFiles = useCallback((f: UploadedFile[]) => setFilesRaw(f), []);

  const setReviewResult = useCallback(
    (r: ReviewResult, meta: ReportMetadata[], cid: string, mdl: string) => {
      setResult(r); setMetadata(meta); setCorrId(cid); setModel(mdl);
    }, [],
  );

  const setRegNoBundle = useCallback((b: RegNoReviewBundle) => setBundle(b), []);

  const clearAll = useCallback(() => {
    setFilesRaw((prev) => { prev.forEach((f) => f.objectUrl && URL.revokeObjectURL(f.objectUrl)); return []; });
    setResult(null); setMetadata(undefined); setCorrId(undefined); setModel(undefined);
    setBundle(null);
  }, []);

  return (
    <AppContext.Provider value={{
      files, result, metadata, correlationId, model, regNoBundle,
      setFiles, setReviewResult, setRegNoBundle, clearAll,
    }}>
      {children}
    </AppContext.Provider>
  );
}

/** Hook — throws if used outside <AppProvider>. */
export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside <AppProvider>");
  return ctx;
}