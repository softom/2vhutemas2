import type { ComponentType } from "react";
import type { ClientWidgetProps } from "./clientWidgets";

// Keys come from the server's widget catalogue. Implementations are added on migration.
export const clientWidgets = new Map<string, ComponentType<ClientWidgetProps>>();
