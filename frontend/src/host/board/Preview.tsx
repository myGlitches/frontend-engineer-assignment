import { useLayoutEffect, useRef, useState } from "react";
import type { Screen } from "../api/client";
import { PAGES_ORIGIN, PREVIEW_HEIGHT, PREVIEW_TITLE_HEIGHT, PREVIEW_WIDTH } from "../config";
import { attachPreview, pointerEnteredPreview, previewLoaded } from "../controller";
import { useDevFaults } from "../dev/faults";
import { Region, RegionError, useRegionScope } from "../failures/Region";
import { useApp } from "../state/store";
import { previewOrigin } from "./layout";

export function Preview({ screen, index }: { screen: Screen; index: number }) {
  const origin = previewOrigin(index);
  const active = useApp((s) => s.activeScreenId === screen.id);
  return (
    <div
      className={`preview${active ? " preview--active" : ""}`}
      style={{ left: origin.x, top: origin.y - PREVIEW_TITLE_HEIGHT, width: PREVIEW_WIDTH }}
    >
      <div className="preview__title" style={{ height: PREVIEW_TITLE_HEIGHT }}>
        {screen.name}
      </div>
      <div className="preview__frame" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}>
        <Region
          region={{ kind: "preview", screenId: screen.id }}
          fallback={({ message, retry }) => (
            <RegionError title="Couldn't connect to this preview" message={message} retry={retry} />
          )}
        >
          <PreviewFrame screen={screen} />
        </Region>
      </div>
    </div>
  );
}

function PreviewFrame({ screen }: { screen: Screen }) {
  const scope = useRegionScope();
  const frame = useRef<HTMLIFrameElement>(null);
  const status = useApp((s) => s.previews[screen.id]);
  const broken = useDevFaults((s) => s.brokenPreview === screen.id);
  const [src] = useState(screen.url);

  useLayoutEffect(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    return attachPreview(screen.id, win, scope);
  }, [screen.id, scope]);

  useLayoutEffect(() => {
    if (!broken || !frame.current) return;
    useDevFaults.setState({ brokenPreview: null });
    frame.current.src = `${PAGES_ORIGIN}/does-not-exist.html`;
  }, [broken]);

  const connected = status?.sessionId != null;
  const errors = status?.pageErrors ?? [];

  return (
    <>
      <iframe
        ref={frame}
        className="preview__iframe"
        title={screen.name}
        src={src}
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        onLoad={() => previewLoaded(screen.id)}
        onPointerEnter={() => pointerEnteredPreview(screen.id)}
        onPointerLeave={() => pointerEnteredPreview(null)}
      />
      {!connected && <div className="preview__connecting">Connecting…</div>}
      {errors.length > 0 && (
        <div className="page-error" data-no-pan title={errors.join("\n")}>
          Page error{errors.length > 1 ? ` ×${errors.length}` : ""}
          <div className="page-error__tip">
            {errors.map((m, i) => (
              <div key={i}>{m}</div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
