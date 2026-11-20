import { lazy, type ComponentType } from "react";
import type { ClientWidgetProps } from "./clientWidgets";

export const clientWidgets = new Map<string, ComponentType<ClientWidgetProps>>([
  ["style_quiz", lazy(() => import("./StyleQuiz"))],
]);
