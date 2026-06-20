import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import { applyAccent, applyTheme, getStoredAccent, getStoredTheme } from "./shared.js";
import "./styles.css";

applyTheme(getStoredTheme());
applyAccent(getStoredAccent());

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
