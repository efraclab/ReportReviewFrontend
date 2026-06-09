import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { FileX } from "lucide-react";

// pdfjs-dist v4 ships its own ESM worker — resolve via import.meta.url for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface Props {
  url: string;
  fileName?: string;
  scale?: number;
  className?: string;
}

interface PageMeta {
  pageNum: number;
  canvas: HTMLCanvasElement;
}

export default function PdfViewer({ url, fileName, scale = 1.6, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages]   = useState<PageMeta[]>([]);
  const [total, setTotal]   = useState(0);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const renderIdRef = useRef(0);

  useEffect(() => {
    if (!url) return;
    setStatus("loading");
    setPages([]);
    setTotal(0);
    const renderId = ++renderIdRef.current;

    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (renderId !== renderIdRef.current) return;

        const count = pdf.numPages;
        setTotal(count);

        const rendered: PageMeta[] = [];

        for (let pageNum = 1; pageNum <= count; pageNum++) {
          if (renderId !== renderIdRef.current) return;

          const page   = await pdf.getPage(pageNum);
          const vp     = page.getViewport({ scale });

          const canvas  = document.createElement("canvas");
          canvas.width  = vp.width;
          canvas.height = vp.height;

          // pdfjs-dist v4 RenderParameters: pass canvas + canvasContext together
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Could not get 2D context");

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.render({ canvas, canvasContext: ctx, viewport: vp } as any).promise;

          rendered.push({ pageNum, canvas });
          setPages([...rendered]);
        }

        if (renderId !== renderIdRef.current) return;
        setStatus("done");
      } catch (e: unknown) {
        if (renderId !== renderIdRef.current) return;
        setErrMsg(e instanceof Error ? e.message : "Failed to load PDF");
        setStatus("error");
      }
    })();

    return () => { renderIdRef.current++; };
  }, [url, scale]);

  // Attach rendered canvases into their DOM slots
  useEffect(() => {
    if (!containerRef.current) return;
    const slots = containerRef.current.querySelectorAll<HTMLDivElement>("[data-page-slot]");
    slots.forEach((slot) => {
      const num  = parseInt(slot.dataset.pageSlot ?? "0", 10);
      const meta = pages.find((p) => p.pageNum === num);
      if (!meta || slot.firstChild === meta.canvas) return;
      slot.innerHTML = "";
      slot.appendChild(meta.canvas);
      Object.assign(meta.canvas.style, {
        width: "100%", height: "auto", display: "block",
      });
    });
  }, [pages]);

  if (status === "error") {
    return (
      <div className={`flex flex-col items-center justify-center py-20 gap-3 ${className}`}>
        <FileX size={40} className="text-red-300" />
        <p className="text-sm font-semibold text-slate-500">Failed to render PDF</p>
        <p className="text-xs text-slate-400 max-w-xs text-center">{errMsg}</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Initial loading spinner */}
      {status === "loading" && pages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-white/20 border-t-white/80 animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-white/70">Rendering PDF…</p>
            {fileName && (
              <p className="text-xs text-white/40 mt-1 max-w-[220px] truncate">{fileName}</p>
            )}
          </div>
        </div>
      )}

      {/* Independent page rendering — each page is its own floating sheet */}
      <div ref={containerRef} className="flex flex-col items-center gap-0 py-6">
        {pages.map(({ pageNum }) => (
          <div key={pageNum} className="flex flex-col items-center w-full">
            {/* Page number pill — sits above each page */}
            <div className="flex items-center gap-2 mb-2 self-center">
              <div className="h-px w-8 bg-white/20" />
              <span className="text-[10px] font-semibold text-white/50 tracking-widest uppercase">
                Page {pageNum}{total > 0 && ` of ${total}`}
              </span>
              <div className="h-px w-8 bg-white/20" />
            </div>

            {/* The page itself — independent white sheet, no outer container border */}
            <div
              data-page-slot={pageNum}
              className="w-[calc(100%-40px)] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.10)] rounded-sm"
              style={{ maxWidth: 860 }}
            />

            {/* Gap between pages — breathing room */}
            <div className="h-8" />
          </div>
        ))}

        {/* Streaming progress */}
        {status === "loading" && pages.length > 0 && (
          <div className="flex items-center gap-2 py-4 text-white/50">
            <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
            <span className="text-xs font-medium">
              Loading page {pages.length + 1}{total > 0 && ` of ${total}`}…
            </span>
          </div>
        )}

        {/* End-of-doc marker */}
        {status === "done" && total > 0 && (
          <div className="flex items-center gap-3 w-[calc(100%-40px)] py-2" style={{ maxWidth: 860 }}>
            <div className="h-px flex-1 bg-white/20" />
            <span className="text-[10px] font-semibold text-white/40 uppercase tracking-widest whitespace-nowrap">
              End of document · {total} page{total !== 1 ? "s" : ""}
            </span>
            <div className="h-px flex-1 bg-white/20" />
          </div>
        )}
      </div>
    </div>
  );
}