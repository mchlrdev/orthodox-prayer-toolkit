import { useState } from "react";
import {
  Accordion,
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { Prayer, VariantMeta } from "@orthodox-prayer-toolkit/core";

type ActiveVariant = { lang: string; variant: string };

type Props = {
  opened: boolean;
  onClose: () => void;
  /** Commit button — create mode writes the prayer; edit mode just closes. */
  onDone: () => void;
  mode?: "edit" | "create";
  busy?: boolean;
  prayer: Prayer;
  activeVariant: ActiveVariant;
  onChange: (prayer: Prayer) => void;
  onActiveVariantChange: (v: ActiveVariant) => void;
};

function variantKey(v: { lang: string; variant: string }): string {
  return `${v.lang}::${v.variant}`;
}

function languagePanelValue(index: number): string {
  return String(index);
}

export function PrayerSettingsModal({
  opened,
  onClose,
  onDone,
  mode = "edit",
  busy = false,
  prayer,
  activeVariant,
  onChange,
  onActiveVariantChange,
}: Props) {
  const isCreate = mode === "create";
  const customEntries = Object.entries(prayer.meta?.custom ?? {});
  const [openedLanguage, setOpenedLanguage] = useState<string | null>(null);

  const updateVariantMeta = (index: number, patch: Partial<VariantMeta>) => {
    const variants = prayer.variants.map((v, i) =>
      i === index ? { ...v, ...patch } : v,
    );
    onChange({ ...prayer, variants });
    const updated = variants[index];
    if (
      updated &&
      prayer.variants[index] &&
      variantKey(prayer.variants[index]!) === variantKey(activeVariant)
    ) {
      onActiveVariantChange({ lang: updated.lang, variant: updated.variant });
    }
  };

  const addVariant = () => {
    const next: VariantMeta = {
      lang: "en",
      variant: `draft-${prayer.variants.length + 1}`,
      title: prayer.variants[0]?.title ?? "Untitled",
      license: "unknown",
      source: "draft",
    };
    const nextIndex = prayer.variants.length;
    onChange({ ...prayer, variants: [...prayer.variants, next] });
    setOpenedLanguage(languagePanelValue(nextIndex));
  };

  const removeVariant = (index: number) => {
    if (prayer.variants.length <= 1) return;
    const removed = prayer.variants[index];
    const variants = prayer.variants.filter((_, i) => i !== index);
    onChange({ ...prayer, variants });
    if (
      removed &&
      variantKey(removed) === variantKey(activeVariant) &&
      variants[0]
    ) {
      onActiveVariantChange({
        lang: variants[0].lang,
        variant: variants[0].variant,
      });
    }
    setOpenedLanguage((current) => {
      if (current === null) return null;
      const openIndex = Number(current);
      if (openIndex === index) return null;
      if (openIndex > index) return languagePanelValue(openIndex - 1);
      return current;
    });
  };

  const setCustom = (key: string, value: string) => {
    const custom = { ...(prayer.meta?.custom ?? {}) };
    if (value.trim() === "") {
      delete custom[key];
    } else {
      custom[key] = value;
    }
    onChange({
      ...prayer,
      meta: {
        ...prayer.meta,
        custom: Object.keys(custom).length > 0 ? custom : undefined,
      },
    });
  };

  const renameCustomKey = (from: string, to: string) => {
    const nextKey = to.trim();
    if (!nextKey || nextKey === from) return;
    const custom = { ...(prayer.meta?.custom ?? {}) };
    const value = custom[from];
    delete custom[from];
    custom[nextKey] = value ?? "";
    onChange({
      ...prayer,
      meta: { ...prayer.meta, custom },
    });
  };

  const addCustomField = () => {
    const custom = { ...(prayer.meta?.custom ?? {}) };
    let n = 1;
    let key = `field_${n}`;
    while (key in custom) {
      n += 1;
      key = `field_${n}`;
    }
    custom[key] = "";
    onChange({
      ...prayer,
      meta: { ...prayer.meta, custom },
    });
  };

  const removeCustomField = (key: string) => {
    const custom = { ...(prayer.meta?.custom ?? {}) };
    delete custom[key];
    onChange({
      ...prayer,
      meta: {
        ...prayer.meta,
        custom: Object.keys(custom).length > 0 ? custom : undefined,
      },
    });
  };

  const idOk = prayer.id.trim().length > 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isCreate ? "New prayer" : "Prayer settings"}
      size="lg"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Tabs defaultValue="basics">
        <Tabs.List mb="md">
          <Tabs.Tab value="basics">Basics</Tabs.Tab>
          <Tabs.Tab value="languages">
            Languages ({prayer.variants.length})
          </Tabs.Tab>
          <Tabs.Tab value="extra">Extra fields</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="basics">
          <Stack gap="sm">
            
            <TextInput
              label="File name"
              value={prayer.id}
              onChange={(e) =>
                onChange({ ...prayer, id: e.currentTarget.value })
              }
              error={!idOk ? "Required" : undefined}
              data-autofocus={isCreate || undefined}
            />
            <Textarea
              label="Description"
              minRows={2}
              autosize
              maxRows={5}
              value={prayer.description ?? ""}
              onChange={(e) =>
                onChange({
                  ...prayer,
                  description: e.currentTarget.value || undefined,
                })
              }
            />
            <Group grow>
              <TextInput
                label="Type"
                description="e.g. prayer, troparion"
                value={prayer.type}
                onChange={(e) =>
                  onChange({ ...prayer, type: e.currentTarget.value })
                }
              />
              <NumberInput
                label="Tone"
                description="1–8, optional"
                min={1}
                max={8}
                allowDecimal={false}
                value={prayer.tone ?? ""}
                onChange={(value) =>
                  onChange({
                    ...prayer,
                    tone: typeof value === "number" ? value : null,
                  })
                }
              />
            </Group>
            <Group grow>
              <TextInput
                label="Book"
                placeholder="horologion, menaion…"
                value={prayer.book ?? ""}
                onChange={(e) =>
                  onChange({
                    ...prayer,
                    book: e.currentTarget.value || undefined,
                  })
                }
              />
              <TextInput
                label="Occasion"
                placeholder="Optional"
                value={prayer.occasion ?? ""}
                onChange={(e) =>
                  onChange({
                    ...prayer,
                    occasion: e.currentTarget.value || undefined,
                  })
                }
              />
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="languages">
          <Stack gap="sm">
            <Group justify="flex-end" align="flex-start">
              <Button
                size="xs"
                leftSection={<IconPlus size={14} />}
                variant="light"
                onClick={addVariant}
              >
                Add language
              </Button>
            </Group>
            <Accordion
              variant="separated"
              radius="md"
              value={openedLanguage}
              onChange={setOpenedLanguage}
            >
              {prayer.variants.map((v, index) => {
                const value = languagePanelValue(index);
                const label = `${v.lang || "—"} / ${v.variant || "—"}`;
                return (
                  <Accordion.Item key={value} value={value}>
                    <Group wrap="nowrap" gap={0} align="stretch">
                      <Accordion.Control style={{ flex: 1 }}>
                        <Text size="sm" fw={600}>
                          {label}
                        </Text>
                        {v.title ? (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {v.title}
                          </Text>
                        ) : null}
                      </Accordion.Control>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="accent"
                        disabled={prayer.variants.length <= 1}
                        leftSection={<IconTrash size={12} />}
                        onClick={() => removeVariant(index)}
                        style={{ alignSelf: "center", marginRight: 8 }}
                      >
                        Remove
                      </Button>
                    </Group>
                    <Accordion.Panel>
                      <Stack gap="xs">
                        <Group grow>
                          <TextInput
                            label="Language Code"
                            value={v.lang}
                            onChange={(e) =>
                              updateVariantMeta(index, {
                                lang: e.currentTarget.value,
                              })
                            }
                          />
                          <TextInput
                            label="Edition"
                            value={v.variant}
                            onChange={(e) =>
                              updateVariantMeta(index, {
                                variant: e.currentTarget.value,
                              })
                            }
                          />
                        </Group>
                        <TextInput
                          label="Display title"
                          value={v.title}
                          onChange={(e) =>
                            updateVariantMeta(index, {
                              title: e.currentTarget.value,
                            })
                          }
                        />
                        <Group grow>
                          <TextInput
                            label="License"
                            value={v.license}
                            onChange={(e) =>
                              updateVariantMeta(index, {
                                license: e.currentTarget.value,
                              })
                            }
                          />
                          <TextInput
                            label="Source"
                            value={v.source}
                            onChange={(e) =>
                              updateVariantMeta(index, {
                                source: e.currentTarget.value,
                              })
                            }
                          />
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="extra">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={addCustomField}
              >
                Add field
              </Button>
            </Group>
            {customEntries.length === 0 ? (
              <Text size="sm" c="dimmed">
                No extra fields yet.
              </Text>
            ) : (
              customEntries.map(([key, value]) => (
                <Group key={key} align="flex-end" wrap="nowrap" gap="xs">
                  <TextInput
                    label="Name"
                    defaultValue={key}
                    key={`key-${key}`}
                    style={{ flex: 1 }}
                    onBlur={(e) => renameCustomKey(key, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        renameCustomKey(key, e.currentTarget.value);
                        e.currentTarget.blur();
                      }
                    }}
                  />
                  <TextInput
                    label="Value"
                    value={value == null ? "" : String(value)}
                    style={{ flex: 1.4 }}
                    onChange={(e) => setCustom(key, e.currentTarget.value)}
                  />
                  <Button
                    color="accent"
                    variant="subtle"
                    px="xs"
                    onClick={() => removeCustomField(key)}
                    aria-label={`Remove ${key}`}
                  >
                    <IconTrash size={16} />
                  </Button>
                </Group>
              ))
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Group justify="flex-end" mt="lg">
        {isCreate ? (
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        <Button
          onClick={onDone}
          loading={busy}
          disabled={isCreate && !idOk}
        >
          Done
        </Button>
      </Group>
    </Modal>
  );
}
