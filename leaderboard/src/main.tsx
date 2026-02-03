import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { enableMockMode } from "./mock";

if (import.meta.env.VITE_MOCK_MODE === "true") {
  enableMockMode();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
