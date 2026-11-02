import { useState } from "react";
import { Menu } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { OcrLanguageStatus } from "../../electron/preload";

export type ScanStep = {
  label: string;
  /** 0–1. */
  progress: number;
};

type Props = {
  name: string;
  /** "Scan · 1841 × 2037 px" or "PDF without text layer · 12 pages". */
  info: string;
  /** Picture of the (first) page. */
  thumb: string | null;
  languages: readonly OcrLanguageStatus[];
  picked: readonly string[];
  onToggle: (code: string) => void;
  busy: boolean;
  step: ScanStep | null;
};

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function shortName(name: string): string {
  return name.replace(/\s*\(.*\)$/, "");
}

/**
 * Import dialog → a dropped image or a PDF without a text layer: which
 * languages are in it (packs download on demand and stay offline), and the
 * progress of downloading and recognising.
 */
export function ScanImportPanel({ name, info, thumb, languages, picked, onToggle, busy, step }: Props) {
  const [extra, setExtra] = useState<string[]>([]);
  const shown = languages.filter(
    (l) => picked.includes(l.code) || l.state === "installed" || extra.includes(l.code),
  );
  const more = languages.filter((l) => !shown.includes(l));

  return (
    <div className="scan-panel">
      <div className="scan-thumb">{thumb ? <img src={thumb} alt="" /> : null}</div>
      <div className="scan-side">
        <div className="scan-file">
          <span className="scan-file-name">{name}</span>
          <span className="scan-file-info">{info} · Text is recognised on this computer (Tesseract)</span>
        </div>
        <div className="scan-langs">
          <span className="scan-langs-title">Languages in the image</span>
          <div className="scan-chips">
            {shown.map((l) => {
              const on = picked.includes(l.code);
              const loading = l.state === "downloading" || l.state === "verifying";
              return (
                <button
                  key={l.code}
                  type="button"
                  className="scan-chip"
                  data-on={on ? "true" : undefined}
                  aria-pressed={on}
                  title={l.name}
                  disabled={busy}
                  onClick={() => onToggle(l.code)}
                >
                  {loading ? (
                    <span className="scan-chip-spinner" />
                  ) : on ? (
                    <IconCheck size={12} stroke={2} />
                  ) : null}
                  <span>{shortName(l.name)}</span>
                  {loading ? (
                    <span className="scan-chip-meta">
                      {mb(l.received)} / {mb(l.size)}
                    </span>
                  ) : l.state !== "installed" ? (
                    <span className="scan-chip-meta">{mb(l.size)}</span>
                  ) : null}
                </button>
              );
            })}
            {more.length > 0 ? (
              <Menu position="bottom-start" withinPortal zIndex={400}>
                <Menu.Target>
                  <button type="button" className="scan-chip" data-more="true" disabled={busy}>
                    + Language
                  </button>
                </Menu.Target>
                <Menu.Dropdown>
                  {more.map((l) => (
                    <Menu.Item
                      key={l.code}
                      onClick={() => {
                        setExtra((e) => [...e, l.code]);
                        onToggle(l.code);
                      }}
                      rightSection={<span className="scan-chip-meta">{mb(l.size)}</span>}
                    >
                      {l.name}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            ) : null}
          </div>
        </div>
        <div className="scan-foot">
          <span className="scan-note">
            Language packs are downloaded once and stay available offline. Church Slavonic: read with Russian for
            now (civil script only).
          </span>
          {step ? (
            <div className="scan-progress" role="status">
              <div className="scan-progress-row">
                <span>{step.label}</span>
                <span className="scan-progress-pct">{Math.round(step.progress * 100)} %</span>
              </div>
              <div className="scan-progress-track">
                <div className="scan-progress-bar" style={{ width: `${Math.round(step.progress * 100)}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
