import { Button, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { getToolkitApi } from "../api";
import { modelDeviceLine, modelOtherGpusLine, modelStatusLine } from "../builtInModel/modelStatusText";
import { useBuiltInModel, useModelDevice } from "../builtInModel/useBuiltInModel";

/** App settings: download, keep and delete the Built-in model. */
export function BuiltInModelSection({ active }: { active: boolean }) {
  const status = useBuiltInModel(active);
  const device = useModelDevice(active && status?.state === "installed");
  const otherGpus = device ? modelOtherGpusLine(device) : null;
  const api = getToolkitApi();

  return (
    <Stack gap={8}>
      <Group justify="space-between" align="baseline">
        <Text size="sm" fw={600}>
          Built-in model
        </Text>
        <Text size="xs" c="dimmed">
          optional
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        Sorts sections during import and answers instructions. Runs offline; sources never
        leave your computer. Import works without the model too.
      </Text>
      {status === null ? null : status.state === "installed" || status.state === "stand-in" ? (
        <Stack gap={4}>
          <div className="model-installed">
            <span className="agent-status-dot" aria-hidden="true" />
            <Text size="xs" className="model-installed-text">
              {modelStatusLine(status)}
            </Text>
            {status.state === "installed" ? (
              <UnstyledButton className="model-delete" onClick={() => void api.removeModel()}>
                Delete
              </UnstyledButton>
            ) : null}
          </div>
          {status.state === "installed" && device ? (
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                {modelDeviceLine(device)}
              </Text>
              {otherGpus ? (
                <Text size="xs" c="dimmed">
                  {otherGpus}
                </Text>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      ) : (
        <div className="model-card">
          <Group gap={10} wrap="nowrap">
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={500} lh="16px">
                {status.model.name}
              </Text>
              <Text size="xs" c={status.state === "error" ? "red" : "dimmed"}>
                {modelStatusLine(status)}
              </Text>
            </Stack>
            {status.state === "downloading" ? (
              <Button size="xs" variant="default" onClick={() => void api.cancelModelDownload()}>
                Cancel
              </Button>
            ) : status.state === "verifying" ? null : (
              <Button size="xs" variant="default" onClick={() => void api.downloadModel()}>
                {status.state === "paused" ? "Resume" : status.state === "error" ? "Try again" : "Download"}
              </Button>
            )}
          </Group>
          {status.received > 0 && status.state !== "absent" ? (
            <div
              className="model-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={status.model.size}
              aria-valuenow={status.received}
            >
              <div
                className="model-progress-bar"
                style={{ width: `${Math.min(100, (status.received / status.model.size) * 100)}%` }}
              />
            </div>
          ) : null}
          {status.state === "paused" || (status.state === "error" && status.received > 0) ? (
            <UnstyledButton className="model-discard" onClick={() => void api.removeModel()}>
              Discard the partial download
            </UnstyledButton>
          ) : null}
        </div>
      )}
    </Stack>
  );
}
