import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Button, Code, Stack, Text } from "@mantine/core";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI crash", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Stack p="xl" maw={720} gap="md">
          <Alert color="accent" title="App crashed">
            <Text size="sm">{this.state.error.message}</Text>
          </Alert>
          <Code block>{this.state.error.stack}</Code>
          <Button onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </Stack>
      );
    }
    return this.props.children;
  }
}
