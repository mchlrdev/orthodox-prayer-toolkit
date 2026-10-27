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
import type { StartImportInput } from "../importDraft/useImportDraft";
import type { Source } from "@orthodox-prayer-toolkit/core";
import { getToolkitApi } from "../api";
import { inputUrl, readImportInput } from "../importDraft/readInput";
import { readHtmlDocument, sanitizeHtml } from "../importDraft/readHtml";
import { parseVariantKey, variantKey, type ActiveVariant } from "../variant";

type Props = {
  opened: boolean;
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

const HTML_FILE = /\.(html?|xhtml)$/i;
const PDF_FILE = /\.pdf$/i;

/**
 * "Import prayer": paste text (formatting from a web page is kept), paste a
 * web address, or drop an HTML or text file; say where it is from and in
 * which Variant.
 */
export function ImportTextModal({
  opened,
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
  /** A dropped PDF, already read (its text shows in the field). */
  const [pdf, setPdf] = useState<{ data: Uint8Array; source: Source; text: string } | null>(
    null,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setText("");
    setOrigin("");
    setHtml(null);
    setPdf(null);
    setFileName(null);
    setBusy(false);
    setError(null);
    const fallback = defaultVariant ?? variants[0] ?? null;
    setPicked(fallback ? variantKey(fallback) : null);
  }, [opened, defaultVariant, variants]);

  const chosen: ActiveVariant | null =
    variants.length > 0
      ? (picked ? parseVariantKey(picked) : null)
      : lang.trim() && edition.trim()
        ? { lang: lang.trim(), variant: edition.trim() }
        : null;
  const ready = text.trim().length > 0 && chosen !== null && !busy;
  const keptHtml = html !== null && html.text === text ? html.html : null;
  const keptPdf = pdf !== null && pdf.text === text ? pdf : null;
  const url = keptHtml === null && keptPdf === null ? inputUrl(text) : null;

  const create = async () => {
    if (!chosen) return;
    if (keptPdf) {
      onCreate({
        source: keptPdf.source,
        file: keptPdf.data,
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
    setPdf(null);
    if (PDF_FILE.test(file.name) || file.type === "application/pdf") {
      setBusy(true);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const { readPdf } = await import("../importDraft/readPdf");
        const source = await readPdf(data, { name: file.name });
        const preview = source.segments
          .filter((s) => !s.furniture)
          .map((s) => s.text)
          .join("\n\n");
        setText(preview);
        setPdf({ data, source, text: preview });
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

  return (
    <Modal opened={opened} onClose={onClose} title="Import prayer" size="lg" centered>
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          Paste text or a web address, or drop a PDF, HTML or text file here.
        </Text>
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
        {keptHtml !== null || keptPdf || url || error ? (
          <Text size="xs" c={error ? "accent" : "dimmed"} mt={-8}>
            {error ??
              (keptPdf
                ? `${fileName}: ${keptPdf.source.segments.length} segments on ${new Set(keptPdf.source.segments.map((s) => s.area?.page)).size} pages. Running heads and page numbers start out excluded.`
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
          {variants.length > 0 ? (
            <Select
              label="Language"
              data={variants.map((v) => ({
                value: variantKey(v),
                label: `${v.lang} / ${v.variant}`,
              }))}
              value={picked}
              allowDeselect={false}
              searchable
              onChange={setPicked}
            />
          ) : (
            <Group grow gap="xs">
              <TextInput
                label="Language code"
                placeholder="de"
                value={lang}
                onChange={(e) => setLang(e.currentTarget.value)}
              />
              <TextInput
                label="Edition"
                value={edition}
                onChange={(e) => setEdition(e.currentTarget.value)}
              />
            </Group>
          )}
        </Group>
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button color="dark" disabled={!ready} loading={busy} onClick={() => void create()}>
            Create draft
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
