import { useState } from "react";
import { Accordion, Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import {
  FALLBACK_KIND_STYLE,
  KIND_PRESETS,
  kindDisplayLabel,
  type KindStyle,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { ConfirmDialog } from "./ConfirmDialog";
import { KindStyleFields } from "./KindStyleFields";
import { orderKinds } from "../prayerEdit";

type Props = {
  /** Every kind the library knows (prayers, templates, style keys). */
  libraryKinds: string[];
  resolved: StyleMap;
  /** Style keys whose kind is in no prayer and no template. */
  unusedStyleKeys: string[];
  /** Patch one kind's library style (applied to the latest styles.json). */
  onPatchStyle: (kind: string, partial: Partial<KindStyle>) => void;
  onRemoveStyle: (kind: string) => void;
};

/**
 * Library settings → Kind styles: one style per kind id for the whole
 * library. Styles of kinds no prayer or template uses are marked unused and
 * can be removed (never automatically).
 */
export function LibraryStylesPanel({
  libraryKinds,
  resolved,
  unusedStyleKeys,
  onPatchStyle,
  onRemoveStyle,
}: Props) {
  const kinds = orderKinds([...KIND_PRESETS, ...libraryKinds]);
  const unused = new Set(unusedStyleKeys);
  const [openedKind, setOpenedKind] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  return (
    <Stack gap="sm">
      <Accordion
        className="settings-accordion"
        variant="separated"
        radius="md"
        value={openedKind}
        onChange={setOpenedKind}
      >
        {kinds.map((kind) => (
          <Accordion.Item key={kind} value={kind}>
            <Group wrap="nowrap" gap={0} align="stretch">
              <Accordion.Control style={{ flex: 1 }}>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" fw={600}>
                    {kindDisplayLabel(kind)}
                  </Text>
                  {unused.has(kind) ? (
                    <Badge size="xs" variant="light" color="gray">
                      unused
                    </Badge>
                  ) : null}
                </Group>
              </Accordion.Control>
              {unused.has(kind) ? (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="accent"
                  leftSection={<IconTrash size={12} />}
                  onClick={() => setConfirmRemove(kind)}
                  style={{ alignSelf: "center", marginRight: 8 }}
                >
                  Remove
                </Button>
              ) : null}
            </Group>
            <Accordion.Panel>
              <KindStyleFields
                style={resolved[kind] ?? FALLBACK_KIND_STYLE}
                onChange={(partial) => onPatchStyle(kind, partial)}
              />
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <ConfirmDialog
        opened={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        zIndex={400}
        title="Remove style?"
        message={`Remove the style of “${confirmRemove ?? ""}” from styles.json? No prayer or template uses this kind.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmRemove) {
            if (openedKind === confirmRemove) setOpenedKind(null);
            onRemoveStyle(confirmRemove);
          }
          setConfirmRemove(null);
        }}
      />
    </Stack>
  );
}
