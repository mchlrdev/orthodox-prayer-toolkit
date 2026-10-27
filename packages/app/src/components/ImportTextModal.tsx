import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type { AddColumnInput, StartImportInput } from "../importDraft/useImportDraft";
import type { Source } from "@orthodox-prayer-toolkit/core";
import { getToolkitApi } from "../api";
import { inputUrl, readImportInput } from "../importDraft/readInput";
import { readHtmlDocument, sanitizeHtml } from "../importDraft/readHtml";
import { parseVariantKey, variantKey, type ActiveVariant } from "../variant";

/** A column of a Source in the draft that can become the second language. */
export type DraftColumn = {
  column: number;
  sourceName: string;
  /** Its blocks' text, for the preview. */
  text: string;
  count: number;
};

/** "Add language": the open Import draft the second language joins. */
export type AddLanguageTarget = {
  title: string;
  /** Language of the first Variant ("de"). */
  firstLang: string;
  /** Blocks of the first Variant. */
  blockCount: number;
  /** Blocks of the first column, when the Source has columns. */
  firstColumnCount: number;
  columns: DraftColumn[];
  /** Variants the draft already has. */
  taken: ActiveVariant[];
  /** Id for the new Source. */
  sourceId: string;
};

type Props = {
  opened: boolean;
  /** Set: add a language to the open draft instead of starting one. */
  addTo?: AddLanguageTarget | null;
  onAddColumn?: (input: AddColumnInput) => void;
  /** Variants known in the library, for the language picker. */
  variants: ActiveVariant[];
  defaultVariant: ActiveVariant | null;
  onClose: () => void;
  onCreate: (input: StartImportInput) => void;
};

/** Plain text of an HTML page, one paragraph per segment (dialog preview only). */
function htmlPreviewText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeHtml(doc);
  return readHtmlDocument(doc).segments.map((s) => s.text).join("\n\n");
}

/** Language picker entry for a language the library has no Variant in yet. */
const OTHER_LANGUAGE = "__other";

const HTML_FILE = /\.(html?|xhtml)$/i;
const PDF_FILE = /\.pdf$/i;
const DOCX_FILE = /\.docx$/i;

/**
 * "Import prayer": paste text (formatting from a web page is kept), paste a
 * web address, or drop an HTML or text file; say where it is from and in
 * which Variant.
 */
export function ImportTextModal({
  opened,
  addTo = null,
  onAddColumn,
  variants,
  defaultVariant,
  onClose,
  onCreate,
}: Props) {
  const [text, setText] = useState("");
  const [origin, setOrigin] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [lang, setLang] = useState("");
  const [edition, setEdition] = useState("standard");
  /** HTML behind the text and the text it produced (dropped once edited). */
  const [html, setHtml] = useState<{ html: string; text: string } | null>(null);
  /** A dropped PDF or Word file, already read (its text shows in the field). */
  const [read, setRead] = useState<{ data: Uint8Array; source: Source; text: string } | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Add language: a column of the draft's Source, or another text. */
  const [from, setFrom] = useState<number | "text">("text");
  const choices = addTo
    ? variants.filter((v) => !addTo.taken.some((t) => t.lang === v.lang && t.variant === v.variant))
    : variants;

  useEffect(() => {
    if (!opened) return;
    setText("");
    setOrigin("");
    setHtml(null);
    setRead(null);
    setFileName(null);
    setBusy(false);
    setError(null);
    setFrom(addTo?.columns[0]?.column ?? "text");
    const fallback = addTo ? (choices[0] ?? null) : (defaultVariant ?? variants[0] ?? null);
    setPicked(fallback ? variantKey(fallback) : null);
    setLang("");
    // Reset once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const column = addTo && from !== "text" ? addTo.columns.find((c) => c.column === from) : undefined;

  const typed = choices.length === 0 || picked === OTHER_LANGUAGE;
  const typedVariant =
    lang.trim() && edition.trim() ? { lang: lang.trim(), variant: edition.trim() } : null;
  const chosen: ActiveVariant | null = typed
    ? typedVariant &&
      !(addTo?.taken ?? []).some(
        (t) => t.lang === typedVariant.lang && t.variant === typedVariant.variant,
      )
      ? typedVariant
      : null
    : picked
      ? parseVariantKey(picked)
      : null;
  const ready = (column !== undefined || text.trim().length > 0) && chosen !== null && !busy;
  const keptHtml = html !== null && html.text === text ? html.html : null;
  const keptRead = read !== null && read.text === text ? read : null;
  const keptPdf = keptRead?.source.format === "pdf" ? keptRead : null;
  const url = keptHtml === null && keptRead === null ? inputUrl(text) : null;

  const create = async () => {
    if (!chosen) return;
    if (column) {
      onAddColumn?.({ column: column.column, origin: origin.trim(), variant: chosen });
      return;
    }
    const id = addTo ? { id: addTo.sourceId } : {};
    if (keptRead) {
      onCreate({
        source: keptRead.source,
        // The page view draws PDF pages; a Word file is not needed again.
        ...(keptPdf ? { file: keptPdf.data } : {}),
        origin: origin.trim() || (fileName ?? ""),
        variant: chosen,
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { source, originHint } = await readImportInput(
        { text, html: keptHtml, fileName },
        (address) => getToolkitApi().fetchSource(address),
        id,
      );
      if (source.segments.length === 0) throw new Error("No text found");
      onCreate({ source, origin: origin.trim() || originHint || "", variant: chosen });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dropFile = async (file: File) => {
    setFileName(file.name);
    setError(null);
    setHtml(null);
    setRead(null);
    const pdfFile = PDF_FILE.test(file.name) || file.type === "application/pdf";
    if (pdfFile || DOCX_FILE.test(file.name)) {
      setBusy(true);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const source = pdfFile
          ? await (await import("../importDraft/readPdf")).readPdf(data, {
              id: addTo?.sourceId,
              name: file.name,
            })
          : await (await import("../importDraft/readDocx")).readDocx(data, {
              id: addTo?.sourceId,
              name: file.name,
            });
        if (source.segments.length === 0) throw new Error("No text found");
        const preview = source.segments
          .filter((s) => !s.furniture)
          .map((s) => s.text)
          .join("\n\n");
        setText(preview);
        setRead({ data, source, text: preview });
      } catch (err) {
        setText("");
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    const content = await file.text();
    if (HTML_FILE.test(file.name) || file.type === "text/html") {
      const preview = htmlPreviewText(content);
      setText(preview);
      setHtml({ html: content, text: preview });
    } else {
      setText(content);
      setHtml(null);
    }
  };

  const languageFields = (
    <Group grow gap="xs">
      <TextInput
        label="Language code"
        placeholder="cu"
        value={lang}
        onChange={(e) => setLang(e.currentTarget.value)}
      />
      <TextInput
        label="Edition"
        value={edition}
        onChange={(e) => setEdition(e.currentTarget.value)}
      />
    </Group>
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={addTo ? "Add language" : "Import prayer"}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          {addTo
            ? `Second language for “${addTo.title || "Untitled"}”. Its segments are paired with the blocks in order.`
            : "Paste text or a web address, or drop a PDF, Word, HTML or text file here."}
        </Text>
        {addTo && addTo.columns.length > 0 ? (
          <div className="import-from" role="radiogroup" aria-label="Where from">
            {addTo.columns.map((c) => (
              <button
                key={c.column}
                type="button"
                role="radio"
                aria-checked={from === c.column}
                className="import-from-option"
                onClick={() => setFrom(c.column)}
              >
                <span className="import-from-label">Column {c.column + 1} of the source</span>
                <span className="import-from-hint">
                  {c.sourceName} · {c.count} {c.count === 1 ? "segment" : "segments"}
                </span>
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={from === "text"}
              className="import-from-option"
              onClick={() => setFrom("text")}
            >
              <span className="import-from-label">Other text or file</span>
              <span className="import-from-hint">Paste, web address or file</span>
            </button>
          </div>
        ) : null}
        {column ? (
          <Textarea
            aria-label="Column text"
            readOnly
            autosize
            minRows={6}
            maxRows={10}
            value={column.text}
            classNames={{ input: "import-column-preview" }}
          />
        ) : (
        <div
          className="import-drop"
          data-over={dragOver ? "true" : undefined}
          onDragOver={(e) => {
            if (![...e.dataTransfer.types].includes("Files")) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            const file = e.dataTransfer.files[0];
            setDragOver(false);
            if (!file) return;
            e.preventDefault();
            void dropFile(file);
          }}
        >
          <Textarea
            aria-label="Text"
            placeholder="Paste text here"
            autosize
            minRows={8}
            maxRows={16}
            value={text}
            data-autofocus
            onChange={(e) => setText(e.currentTarget.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text/html");
              const plain = e.clipboardData.getData("text/plain");
              // Formatting only when the paste is the whole text.
              if (pasted && text.trim() === "" && plain.trim() !== "") {
                setHtml({ html: pasted, text: plain });
                setFileName(null);
              }
            }}
          />
        </div>
        )}
        {!column && (keptHtml !== null || keptRead || url || error) ? (
          <Text size="xs" c={error ? "accent" : "dimmed"} mt={-8}>
            {error ??
              (keptPdf
                ? `${fileName}: ${keptPdf.source.segments.length} segments on ${new Set(keptPdf.source.segments.map((s) => s.area?.page)).size} pages. Running heads and page numbers start out excluded.`
                : keptRead
                  ? `${fileName}: ${keptRead.source.segments.length} paragraphs. Formatting kept: same-looking paragraphs form style groups.`
                  : keptHtml !== null
                  ? `Formatting kept${fileName ? ` from ${fileName}` : ""}: same-looking paragraphs form style groups.`
                  : `The page at ${url!.hostname} is read when you create the draft.`)}
          </Text>
        ) : null}
        <Group grow align="flex-start">
          <TextInput
            label="Source"
            placeholder="Website, book, edition …"
            value={origin}
            onChange={(e) => setOrigin(e.currentTarget.value)}
          />
          {choices.length > 0 ? (
            <Select
              label="Language"
              data={[
                ...choices.map((v) => ({
                  value: variantKey(v),
                  label: `${v.lang} / ${v.variant}`,
                })),
                { value: OTHER_LANGUAGE, label: "Other language…" },
              ]}
              value={picked}
              allowDeselect={false}
              searchable
              onChange={setPicked}
            />
          ) : (
            languageFields
          )}
        </Group>
        {choices.length > 0 && picked === OTHER_LANGUAGE ? (
          <Group grow align="flex-start">
            <span />
            {languageFields}
          </Group>
        ) : null}
        <Group justify={addTo ? "space-between" : "flex-end"} gap="xs" wrap="nowrap">
          {addTo ? (
            <div className="import-add-summary">
              <span>
                {column
                  ? `${column.count} ${column.count === 1 ? "segment" : "segments"} → ${addTo.firstColumnCount} blocks in ${addTo.firstLang}`
                  : `Paired in order with ${addTo.blockCount} blocks in ${addTo.firstLang}`}
              </span>
              <span className="import-add-hint">
                Leftovers stay alone · unpair in the assignment view
              </span>
            </div>
          ) : null}
          <Group gap="xs" wrap="nowrap">
            <Button variant="subtle" color="gray" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button color="dark" disabled={!ready} loading={busy} onClick={() => void create()}>
              {addTo ? "Add" : "Create draft"}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
