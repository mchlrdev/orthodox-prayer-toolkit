import { useState } from "react";
import {
  ActionIcon,
  Code,
  Modal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ValidationError } from "@orthodox-prayer-toolkit/core";

type Props = {
  path: string;
  errors: ValidationError[];
};

export function InvalidPrayerScreen({ path, errors }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fileName = path.split("/").pop() ?? path;

  return (
    <>
      <div className="workspace-empty invalid-prayer">
        <div className="invalid-prayer-copy">
          <Text className="invalid-prayer-kicker">Cannot open prayer</Text>
          <Text className="invalid-prayer-file" title={path}>
            {fileName}
          </Text>
          <Text size="sm" c="dimmed" maw={420} ta="center">
            This file is invalid or corrupted and cannot be opened in the
            editor. Fix the JSON on disk, then refresh the library.
          </Text>
          <Tooltip label="Show validation details" withArrow openDelay={300}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              radius="xl"
              aria-label="Show validation details"
              onClick={() => setDetailsOpen(true)}
              mt="xs"
            >
              <IconInfoCircle size={20} stroke={1.5} />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>

      <Modal
        opened={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Validation details"
        size="md"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Problems found in{" "}
            <Text span fw={600} c="var(--opt-text)">
              {path}
            </Text>
            :
          </Text>
          <Stack gap={8} className="invalid-prayer-errors">
            {errors.length === 0 ? (
              <Text size="sm">No details available.</Text>
            ) : (
              errors.map((err, i) => (
                <div key={i} className="invalid-prayer-error">
                  <Code className="invalid-prayer-path">{err.path}</Code>
                  <Text size="sm">{err.message}</Text>
                </div>
              ))
            )}
          </Stack>
        </Stack>
      </Modal>
    </>
  );
}
