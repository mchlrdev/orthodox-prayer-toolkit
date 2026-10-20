import { Button, Group, List, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import {
  migrationPromptText,
  migrationReportClean,
  migrationTokensKeptReason,
  type LibraryMigrationReport,
  type LibraryMigrationStatus,
} from "../session";

type Props = {
  opened: boolean;
  status: LibraryMigrationStatus;
  /** Set after a run: the dialog shows the result instead of the prompt. */
  report: LibraryMigrationReport | null;
  /** Legacy speaker tokens existed when the run started. */
  legacyTokensBefore: boolean;
  busy?: boolean;
  onMigrate: () => void;
  /** "Not now" (prompt) or "Close" (report). */
  onClose: () => void;
};

function PathList({ paths }: { paths: string[] }) {
  return (
    <ScrollArea.Autosize mah={140} type="auto">
      <List size="xs" spacing={2} pr={20}>
        {paths.map((p) => (
          <List.Item key={p}>
            <Text size="xs" ff="monospace">
              {p}
            </Text>
          </List.Item>
        ))}
      </List>
    </ScrollArea.Autosize>
  );
}

/**
 * One-time migration to per-prayer kinds: asks "N prayers use the old
 * format — migrate now?", then shows what was written, skipped or failed.
 */
export function LibraryMigrationDialog({
  opened,
  status,
  report,
  legacyTokensBefore,
  busy = false,
  onMigrate,
  onClose,
}: Props) {
  if (report) {
    const clean = migrationReportClean(report);
    const tokensKept = migrationTokensKeptReason(report, legacyTokensBefore);
    const n = report.written.length;
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        title={clean ? "Library migrated" : "Library partly migrated"}
        size="md"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            {n} prayer{n === 1 ? "" : "s"} written in the new format
            {report.templatesWritten ? " · templates.json updated" : ""}
            {report.stylesWritten ? " · styles.json updated" : ""}.
          </Text>
          {n > 0 ? <PathList paths={report.written} /> : null}
          {report.skippedUnsaved.length > 0 ? (
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                Skipped (unsaved edits — saving them writes the new format)
              </Text>
              <PathList paths={report.skippedUnsaved} />
            </Stack>
          ) : null}
          {report.failed.length > 0 ? (
            <Stack gap={4}>
              <Text size="sm" fw={600} c="accent">
                Failed (files unchanged)
              </Text>
              <PathList
                paths={report.failed.map((f) => `${f.path} — ${f.reason}`)}
              />
            </Stack>
          ) : null}
          {tokensKept ? (
            <Text size="sm" c="dimmed">
              {tokensKept}
            </Text>
          ) : null}
          <Group justify="flex-end" mt="xs">
            <Button onClick={onClose}>Close</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  const prompt = migrationPromptText(status);
  return (
    <Modal
      opened={opened}
      onClose={busy ? () => undefined : onClose}
      title="Migrate library?"
      size="md"
      centered
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack gap="sm">
        <Text size="sm" fw={600}>
          {prompt.title}
        </Text>
        <List size="sm" spacing={4} pr={20}>
          {prompt.details.map((d) => (
            <List.Item key={d}>{d}</List.Item>
          ))}
        </List>
        <Text size="xs" c="dimmed">
          {prompt.message}
        </Text>
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button onClick={onMigrate} loading={busy}>
            Migrate
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
