import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from "@mantine/core";
import { LEGACY_ACCENT_HEX } from "@orthodox-prayer-toolkit/core";

/** Accent scale — filled shade (5) matches light --opt-accent / LEGACY_ACCENT_HEX. */
const accent: MantineColorsTuple = [
  "#f8e8ec",
  "#efd0d8",
  "#e0a8b6",
  "#c8788c",
  "#a84864",
  LEGACY_ACCENT_HEX,
  "#7a243a",
  "#661e32",
  "#521828",
  "#3d121e",
];

/**
 * Cool neutral dark scale (no blue, no warm brown).
 * Replaces Mantine's default `dark` so Paper/Modal/Input stay gray-black.
 */
const dark: MantineColorsTuple = [
  "#f5f5f5",
  "#e8e8e8",
  "#d0d0d0",
  "#a8a8a8",
  "#787878",
  "#525252",
  "#3a3a3a",
  "#2a2a2a",
  "#1c1c1e",
  "#121212",
];

export const theme = createTheme({
  primaryColor: "dark",
  colors: {
    accent,
    dark,
  },
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
    fontWeight: "600",
  },
  defaultRadius: "md",
  focusRing: "auto",
  cursorType: "pointer",
  spacing: {
    xs: "6px",
    sm: "10px",
    md: "16px",
    lg: "24px",
    xl: "32px",
  },
  shadows: {
    xs: "0 1px 2px rgba(0,0,0,0.04)",
    sm: "0 2px 8px rgba(0,0,0,0.06)",
    md: "0 8px 24px rgba(0,0,0,0.08)",
  },
  components: {
    Button: {
      defaultProps: {
        radius: "md",
      },
      styles: {
        root: {
          transition: "transform 100ms ease-out, background-color 120ms ease",
          "&:active": {
            transform: "scale(0.97)",
          },
        },
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: "md",
      },
      styles: {
        root: {
          transition: "transform 100ms ease-out, background-color 120ms ease",
          "&:active": {
            transform: "scale(0.94)",
          },
        },
      },
    },
    Checkbox: {
      defaultProps: {
        color: "accent",
      },
    },
    SegmentedControl: {
      defaultProps: {
        color: "dark",
      },
    },
    Modal: {
      defaultProps: {
        radius: "lg",
        centered: true,
        overlayProps: { backgroundOpacity: 0.45, blur: 8 },
      },
    },
    Tabs: {
      defaultProps: {
        color: "accent",
      },
    },
    Menu: {
      defaultProps: {
        radius: "md",
        shadow: "md",
      },
    },
    Popover: {
      defaultProps: {
        radius: "md",
        shadow: "md",
      },
    },
  },
});

/** Tie Mantine semantic surfaces to our --opt-* tokens (duochrome shell). */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-body": "var(--opt-bg)",
    "--mantine-color-text": "var(--opt-text)",
    "--mantine-color-dimmed": "var(--opt-text-secondary)",
    "--mantine-color-placeholder": "var(--opt-text-secondary)",
    "--mantine-color-anchor": "var(--opt-accent)",
    "--mantine-color-default": "var(--opt-surface-solid)",
    "--mantine-color-default-hover": "var(--opt-hover)",
    "--mantine-color-default-color": "var(--opt-text)",
    "--mantine-color-default-border": "var(--opt-border)",
  },
  dark: {
    "--mantine-color-body": "var(--opt-bg)",
    "--mantine-color-text": "var(--opt-text)",
    "--mantine-color-bright": "var(--opt-text)",
    "--mantine-color-dimmed": "var(--opt-text-secondary)",
    "--mantine-color-placeholder": "var(--opt-text-secondary)",
    "--mantine-color-anchor": "var(--opt-accent)",
    "--mantine-color-default": "var(--opt-surface-solid)",
    "--mantine-color-default-hover": "var(--opt-hover-strong)",
    "--mantine-color-default-color": "var(--opt-text)",
    "--mantine-color-default-border": "var(--opt-border)",
    /* Accent variants — must live here so Mantine doesn't overwrite styles.css. */
    "--mantine-color-accent-light-color": "var(--opt-accent)",
    "--mantine-color-accent-outline": "var(--opt-accent)",
    "--mantine-color-accent-text": "var(--opt-accent)",
    "--mantine-color-accent-filled": "#b34f6a",
    "--mantine-color-accent-filled-hover": "#9e3f58",
    "--mantine-color-accent-light": "rgba(212, 107, 130, 0.15)",
    "--mantine-color-accent-light-hover": "rgba(212, 107, 130, 0.22)",
    /* Menu.Item hardcodes accent-6; default dark primaryShade maps 3/4 too dark. */
    "--mantine-color-accent-3": "var(--opt-accent)",
    "--mantine-color-accent-4": "var(--opt-accent)",
    "--mantine-color-accent-6": "var(--opt-accent)",
    /* Remap default blue chrome → Accent (no blue accents). */
    "--mantine-color-blue-filled": "var(--mantine-color-accent-filled)",
    "--mantine-color-blue-filled-hover":
      "var(--mantine-color-accent-filled-hover)",
    "--mantine-color-blue-light": "var(--mantine-color-accent-light)",
    "--mantine-color-blue-light-hover":
      "var(--mantine-color-accent-light-hover)",
    "--mantine-color-blue-light-color":
      "var(--mantine-color-accent-light-color)",
    "--mantine-color-blue-outline": "var(--mantine-color-accent-outline)",
    "--mantine-color-blue-text": "var(--mantine-color-accent-text)",
  },
});
