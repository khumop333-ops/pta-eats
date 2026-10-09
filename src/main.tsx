import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa/register";

// Registered before render so the worker has the whole page load to install,
// but the call itself defers to window `load` internally and never blocks paint.
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
