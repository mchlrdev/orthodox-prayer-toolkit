import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { theme, cssVariablesResolver } from "./theme";
import { loadAppearancePrefs } from "./appearancePrefs";
import { toMantineColorScheme } from "./mantineColorScheme";

const initialScheme = toMantineColorScheme(
  loadAppearancePrefs().colorScheme,
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider
      theme={theme}
      defaultColorScheme={initialScheme}
      cssVariablesResolver={cssVariablesResolver}
    >
      <Notifications position="bottom-right" />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MantineProvider>
  </React.StrictMode>,
);
