import React from "react";
import { createRoot } from "react-dom/client";

import App, { applyAccent, applyTheme, getStoredAccent, getStoredTheme } from "./App.jsx";
import "./styles.css";

applyTheme(getStoredTheme());
applyAccent(getStoredAccent());

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
