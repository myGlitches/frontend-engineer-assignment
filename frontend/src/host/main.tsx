import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connectionFor } from "./connection/hub";
import { useFailures } from "./failures/regions";
import { useApp } from "./state/store";
import "./styles.css";

if (import.meta.env.DEV) Object.assign(window, { __board: { useApp, useFailures, connectionFor } });

createRoot(document.getElementById("root")!).render(<App />);
