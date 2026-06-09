import { useState } from "react";
import {
  User, Lock, Eye, EyeOff, AlertCircle, CheckCircle2,
  Loader2, LogIn, FileText, Shield, Zap, Database,
} from "lucide-react";
import { login } from "../services/auth";

// ── Types ────────────────────────────────────────────────────────────
interface Props {
  onLoginSuccess: () => void;
}

interface FormData {
  employeeId: string;
  password: string;
}

interface FormErrors {
  employeeId?: string;
  password?: string;
}

// ── JWT decoder — stores user info in localStorage ───────────────────
const decodeAndStoreUserData = (token: string): boolean => {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return false;
    const decoded = JSON.parse(
      atob(base64Url.replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (decoded) {
      localStorage.setItem("EmployeeId",  decoded.EmployeeId  || "");
      localStorage.setItem("Username",    decoded.Username    || "");
      localStorage.setItem("Designation",  decoded.Designation  || "");
      localStorage.setItem("Role",        decoded.Role        || "");
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

// ── Component ────────────────────────────────────────────────────────
const LoginPage = ({ onLoginSuccess }: Props) => {
  const [formData, setFormData]         = useState<FormData>({ employeeId: "", password: "" });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading]       = useState<boolean>(false);
  const [apiError, setApiError]         = useState<string | null>(null);
  const [success, setSuccess]           = useState<boolean>(false);
  const [errors, setErrors]             = useState<FormErrors>({});
  const [focused, setFocused]           = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(p => ({ ...p, [name]: value }));
    if (errors[name as keyof FormErrors]) setErrors(p => ({ ...p, [name]: "" }));
    if (apiError) setApiError(null);
  };

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!formData.employeeId.trim()) e.employeeId = "Employee ID is required";
    if (!formData.password.trim())   e.password   = "Password is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const res: any = await login({
        employeeId: formData.employeeId.trim(),
        password:   formData.password.trim(),
      });
      if (res?.token) {
        localStorage.setItem("authToken", res.token);
        if (decodeAndStoreUserData(res.token)) {
          setSuccess(true);
          setTimeout(onLoginSuccess, 900);
        } else {
          throw new Error("Token decoding failed.");
        }
      } else {
        throw new Error(res?.message || "Invalid credentials.");
      }
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : "Login failed.";
      if (
        msg.includes("401") ||
        msg.toLowerCase().includes("unauthorized") ||
        msg.toLowerCase().includes("invalid")
      ) {
        msg = "Invalid Employee ID or Password.";
      }
      setApiError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading && !success) handleSubmit();
  };

  const features: { icon: React.ReactNode; label: string; sub: string }[] = [
    { icon: <Zap     style={{ width: "16px", height: "16px" }} />, label: "Fast Review",  sub: "AI-graded under a minute"     },
    { icon: <Shield  style={{ width: "16px", height: "16px" }} />, label: "Confidential", sub: "Reports never stored"          },
    { icon: <Database style={{ width: "16px", height: "16px" }} />, label: "AI-Powered",  sub: "Claude analyses every param"   },
  ];

  return (
    <div
      style={{ minHeight: "100vh", display: "flex", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}
      onKeyDown={handleKeyDown}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600&family=DM+Serif+Display&display=swap');

        @keyframes fadeUp    { from { opacity:0; transform:translateY(18px);  } to { opacity:1; transform:translateY(0);  } }
        @keyframes fadeLeft  { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0);  } }
        @keyframes fadeRight { from { opacity:0; transform:translateX(16px);  } to { opacity:1; transform:translateX(0);  } }
        @keyframes livePulse { 0%,100% { opacity:1; transform:scale(1);   } 50% { opacity:0.4; transform:scale(1.35); } }
        @keyframes shake     { 0%,100% { transform:translateX(0);  } 20% { transform:translateX(-6px); } 40% { transform:translateX(6px); } 60% { transform:translateX(-3px); } 80% { transform:translateX(3px); } }
        @keyframes successPop{ 0% { opacity:0; transform:scale(0.8); } 60% { transform:scale(1.05); } 100% { opacity:1; transform:scale(1); } }
        @keyframes shimmer   { 0% { transform:translateX(-100%) skewX(-20deg); } 100% { transform:translateX(300%) skewX(-20deg); } }
        @keyframes dotPulse  { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes spin      { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }

        .anim-left  { animation: fadeLeft  0.5s ease both; }
        .anim-right { animation: fadeRight 0.5s ease both; }
        .anim-up    { animation: fadeUp    0.45s ease both; }
        .anim-shake { animation: shake     0.4s ease; }
        .anim-pop   { animation: successPop 0.4s ease both; }
        .dot-live   { animation: dotPulse  2s ease-in-out infinite; }
        .spin       { animation: spin      1s linear infinite; }

        .input-field {
          width: 100%;
          border: none;
          border-bottom: 1.5px solid #e2e8f0;
          background: transparent;
          padding: 10px 36px 10px 28px;
          font-size: 13.5px;
          color: #1e293b;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
          font-family: inherit;
        }
        .input-field::placeholder { color: #94a3b8; font-weight: 300; }
        .input-field:focus         { border-bottom-color: #2563eb; }
        .input-field.err           { border-bottom-color: #ef4444; }
        .input-field.err:focus     { border-bottom-color: #ef4444; }

        .btn-signin {
          width: 100%;
          padding: 13px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 50%, #0ea5e9 100%);
          color: white;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          position: relative;
          overflow: hidden;
          transition: opacity 0.2s, transform 0.15s;
          font-family: inherit;
          letter-spacing: 0.01em;
        }
        .btn-signin:hover:not(:disabled) { opacity: 0.91; transform: translateY(-1px); }
        .btn-signin:active:not(:disabled){ transform: translateY(0); }
        .btn-signin:disabled             { opacity: 0.55; cursor: not-allowed; }
        .btn-shimmer {
          position: absolute; top: 0; left: 0;
          width: 45px; height: 100%;
          background: rgba(255,255,255,0.28);
          animation: shimmer 2.4s ease-in-out infinite;
        }

        .feature-pill {
          display: flex; align-items: center; gap: 10px;
          padding: 11px 16px; flex: 1;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
        }
      `}</style>

      {/* ════════════════ LEFT PANEL ════════════════ */}
      <div
        className="anim-left"
        style={{
          width: "52%",
          background: "linear-gradient(145deg, #0f172a 0%, #1e3a5f 40%, #0c4a6e 70%, #064e3b 100%)",
          display: "flex", flexDirection: "column",
          padding: "48px 52px",
          position: "relative", overflow: "hidden",
        }}
      >
        {/* Grid texture */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.07,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }} />
        {/* Glow blobs */}
        <div style={{ position:"absolute", top:"-80px", right:"-60px", width:"280px", height:"280px", borderRadius:"50%", background:"radial-gradient(circle, rgba(14,165,233,0.18) 0%, transparent 70%)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:"-60px", left:"20px",  width:"240px", height:"240px", borderRadius:"50%", background:"radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)", pointerEvents:"none" }} />

        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:"10px", position:"relative", zIndex:1 }}>
          <div style={{ width:"38px", height:"38px", borderRadius:"9px", background:"linear-gradient(135deg, #2563eb, #0ea5e9)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <FileText style={{ width:"18px", height:"18px", color:"white" }} />
          </div>
          <span style={{ fontSize:"16px", fontWeight:600, color:"white", letterSpacing:"-0.01em" }}>LIMS Review</span>
          <span style={{ fontSize:"10px", fontWeight:500, color:"#38bdf8", background:"rgba(56,189,248,0.15)", border:"1px solid rgba(56,189,248,0.3)", padding:"2px 8px", borderRadius:"20px", letterSpacing:"0.06em" }}>AI</span>
        </div>

        {/* Hero */}
        <div style={{ marginTop:"auto", position:"relative", zIndex:1 }}>
          <p style={{ fontSize:"11px", fontWeight:500, color:"#38bdf8", letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:"14px" }}>
            AI-Powered Lab Intelligence
          </p>
          <h1 style={{ fontSize:"38px", fontWeight:600, color:"white", lineHeight:1.2, margin:"0 0 8px",}}>
            LIMS Report Review,
            <br />
            <span style={{ color:"#7dd3fc" }}>by AI</span>
          </h1>
          <p style={{ fontSize:"13.5px", color:"rgba(255, 255, 255, 0.77)", fontWeight:300, lineHeight:1.7, maxWidth:"380px", marginTop:"12px" }}>
            Upload PDF reports or pull directly from the LIMS database. Claude analyses every parameter, flags compliance gaps, and grades your report in seconds.
          </p>

          {/* Feature pills */}
          <div style={{ display:"flex", gap:"10px", marginTop:"32px" }}>
            {features.map((f, i) => (
              <div key={i} className="feature-pill">
                <div style={{ color:"#38bdf8", flexShrink:0 }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize:"11.5px", fontWeight:500, color:"white" }}>{f.label}</div>
                  <div style={{ fontSize:"10px",   fontWeight:300, color:"rgba(255,255,255,0.4)" }}>{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:"40px", position:"relative", zIndex:1 }}>
          <span style={{ fontSize:"10px", color:"rgba(255,255,255,0.25)", fontWeight:300 }}>© 2025 EFRAC. All rights reserved.</span>
          <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
            <span className="dot-live" style={{ width:"7px", height:"7px", borderRadius:"50%", background:"#10b981", display:"inline-block" }} />
            <span style={{ fontSize:"10px", color:"rgba(255,255,255,0.35)", fontWeight:300 }}>AI systems online</span>
          </div>
        </div>
      </div>

      {/* ════════════════ RIGHT PANEL ════════════════ */}
      <div
        className="anim-right"
        style={{
          width:"48%",
          background:"linear-gradient(160deg, #f8fafc 0%, #ffffff 50%, #f0f9ff 100%)",
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:"48px 40px",
          position:"relative", overflow:"hidden",
        }}
      >
        {/* Soft accents */}
        <div style={{ position:"absolute", top:"-80px", right:"-80px", width:"300px", height:"300px", borderRadius:"50%", background:"radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:"-60px", left:"-60px", width:"240px", height:"240px", borderRadius:"50%", background:"radial-gradient(circle, rgba(16,185,129,0.05) 0%, transparent 70%)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", inset:0, opacity:0.018, backgroundImage:"radial-gradient(rgba(37,99,235,0.9) 1px, transparent 1px)", backgroundSize:"26px 26px", pointerEvents:"none" }} />

        <div style={{ width:"100%", maxWidth:"380px", position:"relative", zIndex:1 }}>

          {/* Form header */}
          <div className="anim-up" style={{ marginBottom:"36px", animationDelay:"0.1s" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"12px" }}>
              <div style={{ width:"2px", height:"16px", borderRadius:"2px", background:"linear-gradient(to bottom, #2563eb, #0ea5e9)" }} />
              <span style={{ fontSize:"10px", fontWeight:500, color:"#2563eb", letterSpacing:"0.22em", textTransform:"uppercase" }}>Secure Access</span>
            </div>
            <h2 style={{ fontSize:"28px", fontWeight:300, color:"#0f172a", margin:0, letterSpacing:"-0.02em", lineHeight:1.2 }}>
              Welcome <strong style={{ fontWeight:600 }}>back</strong>
            </h2>
            <p style={{ fontSize:"12.5px", color:"#94a3b8", fontWeight:300, lineHeight:1.6, marginTop:"6px" }}>
              Sign in to access the AI Report Review System
            </p>
          </div>

          {/* Fields */}
          <div style={{ display:"flex", flexDirection:"column", gap:"28px" }}>

            {/* Employee ID */}
            <div className="anim-up" style={{ animationDelay:"0.18s" }}>
              <label style={{
                display:"block", fontSize:"10px", fontWeight:500,
                letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:"10px",
                color: errors.employeeId ? "#ef4444" : focused === "employeeId" ? "#2563eb" : "#94a3b8",
                transition:"color 0.2s",
              }}>
                Employee ID
              </label>
              <div style={{ position:"relative" }}>
                <div style={{
                  position:"absolute", left:0, top:"50%", transform:"translateY(-50%)",
                  color: errors.employeeId ? "#ef4444" : focused === "employeeId" ? "#2563eb" : "#cbd5e1",
                  transition:"color 0.2s", pointerEvents:"none",
                }}>
                  <User style={{ width:"15px", height:"15px" }} />
                </div>
                <input
                  type="text"
                  name="employeeId"
                  value={formData.employeeId}
                  onChange={handleChange}
                  onFocus={() => setFocused("employeeId")}
                  onBlur={() => setFocused(null)}
                  placeholder="Your employee ID"
                  autoComplete="username"
                  className={[
                    "input-field",
                    errors.employeeId ? "err" : "",
                    apiError ? "anim-shake" : "",
                  ].filter(Boolean).join(" ")}
                />
                {focused === "employeeId" && !errors.employeeId && (
                  <div style={{ position:"absolute", right:0, top:"50%", transform:"translateY(-50%)" }}>
                    <span style={{ width:"6px", height:"6px", borderRadius:"50%", background:"#2563eb", display:"block", animation:"livePulse 1.6s ease-in-out infinite" }} />
                  </div>
                )}
              </div>
              {errors.employeeId && (
                <p className="anim-up" style={{ marginTop:"6px", fontSize:"11px", color:"#ef4444", display:"flex", alignItems:"center", gap:"5px", margin:"6px 0 0" }}>
                  <AlertCircle style={{ width:"12px", height:"12px", flexShrink:0 }} />
                  {errors.employeeId}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="anim-up" style={{ animationDelay:"0.24s" }}>
              <label style={{
                display:"block", fontSize:"10px", fontWeight:500,
                letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:"10px",
                color: errors.password ? "#ef4444" : focused === "password" ? "#2563eb" : "#94a3b8",
                transition:"color 0.2s",
              }}>
                Password
              </label>
              <div style={{ position:"relative" }}>
                <div style={{
                  position:"absolute", left:0, top:"50%", transform:"translateY(-50%)",
                  color: errors.password ? "#ef4444" : focused === "password" ? "#2563eb" : "#cbd5e1",
                  transition:"color 0.2s", pointerEvents:"none",
                }}>
                  <Lock style={{ width:"15px", height:"15px" }} />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className={["input-field", errors.password ? "err" : ""].filter(Boolean).join(" ")}
                  style={{ paddingRight:"36px" }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  style={{ position:"absolute", right:0, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#94a3b8", padding:"4px", display:"flex", alignItems:"center" }}
                >
                  {showPassword
                    ? <EyeOff style={{ width:"15px", height:"15px" }} />
                    : <Eye    style={{ width:"15px", height:"15px" }} />}
                </button>
              </div>
              {errors.password && (
                <p className="anim-up" style={{ marginTop:"6px", fontSize:"11px", color:"#ef4444", display:"flex", alignItems:"center", gap:"5px", margin:"6px 0 0" }}>
                  <AlertCircle style={{ width:"12px", height:"12px", flexShrink:0 }} />
                  {errors.password}
                </p>
              )}
            </div>

            {/* API error banner */}
            {apiError && (
              <div className="anim-up anim-shake" style={{ display:"flex", alignItems:"flex-start", gap:"10px", padding:"12px 14px", background:"#fef2f2", borderRadius:"10px", border:"1px solid #fecaca" }}>
                <AlertCircle style={{ width:"15px", height:"15px", color:"#ef4444", flexShrink:0, marginTop:"1px" }} />
                <p style={{ fontSize:"12.5px", color:"#dc2626", fontWeight:400, margin:0, lineHeight:1.5 }}>{apiError}</p>
              </div>
            )}

            {/* Success banner */}
            {success && (
              <div className="anim-pop" style={{ display:"flex", alignItems:"center", gap:"10px", padding:"12px 14px", background:"#f0fdf4", borderRadius:"10px", border:"1px solid #bbf7d0" }}>
                <CheckCircle2 style={{ width:"15px", height:"15px", color:"#16a34a", flexShrink:0 }} />
                <p style={{ fontSize:"12.5px", color:"#15803d", fontWeight:400, margin:0 }}>Login successful! Redirecting…</p>
              </div>
            )}

            {/* Submit */}
            <div className="anim-up" style={{ paddingTop:"4px", animationDelay:"0.3s" }}>
              <button
                className="btn-signin"
                onClick={handleSubmit}
                disabled={isLoading || success}
              >
                {!isLoading && !success && <span className="btn-shimmer" />}
                {isLoading ? (
                  <><Loader2 className="spin" style={{ width:"16px", height:"16px" }} /><span>Signing in…</span></>
                ) : success ? (
                  <><CheckCircle2 style={{ width:"16px", height:"16px" }} /><span>Success!</span></>
                ) : (
                  <><LogIn style={{ width:"16px", height:"16px" }} /><span>Sign In</span></>
                )}
              </button>
            </div>

            {/* Support */}
            <p className="anim-up" style={{ textAlign:"center", fontSize:"11.5px", color:"#94a3b8", fontWeight:300, animationDelay:"0.36s", margin:0 }}>
              Having trouble signing in?{" "}
              <button
                type="button"
                style={{ background:"none", border:"none", cursor:"pointer", color:"#2563eb", fontWeight:500, fontSize:"11.5px", textDecoration:"underline", textDecorationColor:"rgba(37,99,235,0.35)", textUnderlineOffset:"3px", fontFamily:"inherit" }}
              >
                Contact Support
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;