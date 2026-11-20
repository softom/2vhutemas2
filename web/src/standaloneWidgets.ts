import { observeWidgets } from "./clientWidgets";
import { clientWidgets } from "./clientWidgetRegistry";

observeWidgets(document.body, clientWidgets);
