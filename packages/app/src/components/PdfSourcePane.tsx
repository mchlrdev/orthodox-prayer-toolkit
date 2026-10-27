import { useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { SourceSegment } from "@orthodox-prayer-toolkit/core";
import { openPdf } from "../importDraft/readPdf";

const PAGE_WIDTH = 340;

type Props = {
  data: Uint8Array;
  segments: readonly SourceSegment[];
  page: number;
  onPageChange: (page: number) => void;
  letters: ReadonlyMap<string, string>;
  excluded: ReadonlySet<string>;
  /** Segments of the block holding the caret. */
  active: ReadonlySet<string>;
  /** Segments of a shift-click range. */
  selected: ReadonlySet<string>;
  onSegmentClick: (segmentId: string, extend: boolean) => void;
};

/** One PDF page drawn by pdf.js with a frame on every Source segment. */
export function PdfSourcePane({
  data,
  segments,
  page,
  onPageChange,
  letters,
  excluded,
  active,
  selected,
  onSegmentClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const pageCount = doc?.numPages ?? Math.max(1, ...segments.map((s) => s.area?.page ?? 1));

  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    openPdf(data)
      .then((d) => {
        opened = d;
        if (alive) setDoc(d);
        else void d.destroy();
      })
      .catch((err: unknown) => {
        if (alive) setFailed(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
      void opened?.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let task: RenderTask | null = null;
    let alive = true;
    void doc.getPage(page).then((p) => {
      if (!alive || !canvasRef.current) return;
      const base = p.getViewport({ scale: 1 });
      const scale = PAGE_WIDTH / base.width;
      const ratio = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: scale * ratio });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${PAGE_WIDTH}px`;
      canvas.style.height = `${base.height * scale}px`;
      setSize({ width: base.width, height: base.height });
      task = p.render({ canvas, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, page]);

  const onPage = useMemo(
    () => segments.filter((s) => s.area?.page === page),
    [segments, page],
  );
  const scale = size ? PAGE_WIDTH / size.width : 1;

  return (
    <div className="pdf-pane">
      <div className="pdf-pane-nav">
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <IconChevronLeft size={14} />
        </ActionIcon>
        <span>
          Page {page} of {pageCount}
        </span>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <IconChevronRight size={14} />
        </ActionIcon>
      </div>
      <div className="pdf-page" style={{ width: PAGE_WIDTH }}>
        <canvas ref={canvasRef} aria-label={`PDF page ${page}`} />
        {failed ? <div className="pdf-page-error">{failed}</div> : null}
        {size
          ? onPage.map((seg) => {
              const a = seg.area!;
              const letter = seg.group ? letters.get(seg.group) : undefined;
              return (
                <button
                  type="button"
                  key={seg.id}
                  className="pdf-seg"
                  data-excluded={excluded.has(seg.id) ? "true" : undefined}
                  data-active={active.has(seg.id) ? "true" : undefined}
                  data-selected={selected.has(seg.id) ? "true" : undefined}
                  title={seg.text}
                  style={{
                    left: (a.x - 2) * scale,
                    top: (a.y - 2) * scale,
                    width: (a.width + 4) * scale,
                    height: (a.height + 4) * scale,
                  }}
                  onClick={(e) => onSegmentClick(seg.id, e.shiftKey)}
                >
                  {letter ? <span className="pdf-seg-group">{letter}</span> : null}
                </button>
              );
            })
          : null}
      </div>
      <div className="pdf-legend">
        <span>Frame = segment</span>
        <span>Shift-click = range</span>
        <span>Dashed = excluded</span>
      </div>
    </div>
  );
}
