import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
  Outlet,
} from "react-router-dom";

import Login from "./pages/Login";
import DashboardPage from "./pages/DashboardPage";
import UploadPage from "./pages/UploadPage";
import PreviewPage from "./pages/PreviewPage";
import ReviewPage from "./pages/ReviewPage";
import RegNoEntryPage from "./pages/RegNoEntryPage";
import RegNoReviewPage from "./pages/RegNoReviewPage";

import { AppProvider, useAppContext } from "./AppContext";
import { getReview, pruneExpired } from "./services/reviewHistoryStore";
import type { UploadedFile } from "./types/UploadedFile";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

//Bypass login for now:

function isAuthenticated(): boolean {
  // Bypass authentication for development/testing
  return true;
}

/* 
function isAuthenticated(): boolean {
  const token = localStorage.getItem("authToken");
  if (!token) return false;
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return false;
    const decoded = JSON.parse(atob(base64Url.replace(/-/g, "+").replace(/_/g, "/")));
    if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
      localStorage.clear();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
*/

// ─── Guards ───────────────────────────────────────────────────────────────────

/** Redirects unauthenticated users to /login. */
function ProtectedRoute() {
  return isAuthenticated() ? <Outlet /> : <Navigate to="/login" replace />;
}

/** Redirects already-authenticated users away from /login. */
function PublicOnlyRoute() {
  return isAuthenticated() ? <Navigate to="/" replace /> : <Outlet />;
}

// ─── Page wrappers (bridge props ↔ context + navigate) ───────────────────────

function LoginWrapper() {
  const navigate = useNavigate();
  return <Login onLoginSuccess={() => navigate("/", { replace: true })} />;
}

function DashboardWrapper() {
  const navigate = useNavigate();
  const { clearAll } = useAppContext();

  const handleLogout = () => {
    localStorage.clear();
    clearAll();
    navigate("/login", { replace: true });
  };

  return (
    <DashboardPage
      onPickFiles={() => navigate("/upload")}
      onPickRegNo={() => navigate("/regno")}
      onLogout={handleLogout}
    />
  );
}

function UploadWrapper() {
  const navigate = useNavigate();
  const { setFiles, clearAll } = useAppContext();

  // Prune expired history on mount (same as old App)
  useEffect(() => { pruneExpired().catch((e) => console.warn("[history] prune:", e)); }, []);

  const handlePreview = (files: UploadedFile[]) => {
    setFiles(files);
    navigate("/upload/preview");
  };

  const handleOpenStoredReview = async (id: string) => {
    const stored = await getReview(id);
    if (!stored) return;
    clearAll();
    const restored: UploadedFile[] = stored.files.map((f) => {
      const file = new File([f.blob], f.name, { type: f.type });
      return { id: f.id, file, name: f.name, size: f.size, objectUrl: URL.createObjectURL(f.blob) };
    });
    setFiles(restored);
    navigate("/upload/preview");
  };

  return (
    <UploadPage
      onPreview={handlePreview}
      onOpenStoredReview={handleOpenStoredReview}
      onBack={() => navigate("/")}
    />
  );
}

function PreviewWrapper() {
  const navigate = useNavigate();
  const { files, setReviewResult } = useAppContext();

  // Guard: if someone navigates directly to /upload/preview with no files, send them back
  if (files.length === 0) return <Navigate to="/upload" replace />;

  return (
    <PreviewPage
      files={files}
      onBack={() => navigate("/upload")}
      onResult={(r, meta, cid, mdl) => {
        setReviewResult(r, meta, cid, mdl);
        navigate("/upload/review");
      }}
    />
  );
}

function ReviewWrapper() {
  const navigate = useNavigate();
  const { files, result, metadata, correlationId, model, clearAll } = useAppContext();

  if (!result) return <Navigate to="/upload" replace />;

  return (
    <ReviewPage
      files={files}
      result={result}
      metadata={metadata}
      correlationId={correlationId}
      model={model}
      onBack={() => { clearAll(); navigate("/"); }}
    />
  );
}

function RegNoEntryWrapper() {
  const navigate = useNavigate();
  const { setRegNoBundle } = useAppContext();

  // Read optional :regNo segment from the URL
  // e.g. /regno/EFRAC%2F2025%2F0042  →  paramRegNo = "EFRAC%2F2025%2F0042"
  const { regNo: paramRegNo } = useParams<{ regNo?: string }>();

  return (
    <RegNoEntryPage
      // Decode URL encoding so "EFRAC%2F2025%2F0042" becomes "EFRAC/2025/0042"
      initialRegNo={paramRegNo ? decodeURIComponent(paramRegNo) : undefined}
      onBack={() => navigate("/")}
      onResult={(bundle) => {
        setRegNoBundle(bundle);
        navigate("/regno/review");
      }}
    />
  );
}

function RegNoReviewWrapper() {
  const navigate = useNavigate();
  const { regNoBundle, clearAll } = useAppContext();

  if (!regNoBundle) return <Navigate to="/regno" replace />;

  return (
    <RegNoReviewPage
      bundle={regNoBundle}
      onBack={() => { clearAll(); navigate("/"); }}
    />
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          {/* Public */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginWrapper />} />
          </Route>

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardWrapper />} />
            <Route path="/upload" element={<UploadWrapper />} />
            <Route path="/upload/preview" element={<PreviewWrapper />} />
            <Route path="/upload/review" element={<ReviewWrapper />} />

            {/* /regno        — manual entry (no pre-fill)          */}
            {/* /regno/:regNo — deep-link with reg no in URL param  */}
            {/* /regno/review — review result page (must come last) */}
            <Route path="/regno" element={<RegNoEntryWrapper />} />
            <Route path="/regno/:regNo" element={<RegNoEntryWrapper />} />
            <Route path="/regno/review" element={<RegNoReviewWrapper />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}