"use client";

import { Moon, Sun } from "lucide-react";
import { useShell } from "./app-shell";
import { IconButton, iconProps } from "./icon-button";

export function ThemeToggle() {
  const { theme, setTheme } = useShell();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton label={`Switch to ${next} theme`} onClick={() => setTheme(next)} data-testid="theme-toggle">
      {theme === "dark" ? <Sun {...iconProps} /> : <Moon {...iconProps} />}
    </IconButton>
  );
}
