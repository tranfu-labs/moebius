import { createRoot } from "react-dom/client";

export function mountConsoleApp(app: JSX.Element): void {
  const rootElement = document.getElementById("root");
  if (rootElement !== null) createRoot(rootElement).render(app);
}
