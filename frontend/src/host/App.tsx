import { useEffect } from "react";
import { BoardRegion } from "./board/Board";
import { handleShortcut, pointerLeftWindow, setMode } from "./controller";
import { DevMenu } from "./dev/DevMenu";
import { Inspector } from "./inspector/Inspector";
import { LayersPanel } from "./layers/LayersPanel";
import { useApp } from "./state/store";

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (handleShortcut(e)) e.preventDefault();
    };
    const onLeave = () => pointerLeftWindow();
    window.addEventListener("keydown", onKey);
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <LayersPanel />
        <BoardRegion />
        <Inspector />
      </main>
      {import.meta.env.DEV && <DevMenu />}
    </div>
  );
}

function Toolbar() {
  const mode = useApp((s) => s.mode);
  const zoom = useApp((s) => s.viewport.zoom);
  return (
    <header className="toolbar">
      <div className="toolbar__brand">Board</div>
      <div className="segmented" role="radiogroup" aria-label="Mode">
        <button type="button" role="radio" aria-checked={mode === "select"} onClick={() => setMode("select")}>
          Select <kbd>V</kbd>
        </button>
        <button type="button" role="radio" aria-checked={mode === "interact"} onClick={() => setMode("interact")}>
          Interact <kbd>I</kbd>
        </button>
      </div>
      <div className="toolbar__zoom">{Math.round(zoom * 100)}%</div>
    </header>
  );
}
