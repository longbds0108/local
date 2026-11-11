import type { CSSProperties } from "react";

/** Entrance delay step for `.fx-rise` (each step is 90 ms; see globals.css). */
export const fxDelay = (step: number): CSSProperties => ({ "--d": step }) as CSSProperties;
