/**
 * FLOW viewer web app entry. Phase 0: placeholder shell.
 * Feed + money-flow animation + net-balance meter land in Phases 1–5.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>FLOW</h1>
      <p>Money flows in real time — out to creators, in from ads.</p>
      <p style={{ opacity: 0.6 }}>Phase 0 scaffold. UI lands in Phases 1–5.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
