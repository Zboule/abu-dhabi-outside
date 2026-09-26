import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// One shared popover for the Outdoor page: hover shows it (desktop), a tap pins it
// (phone, where there is no hover). Fixed-positioned and clamped to the viewport so
// it never runs off the side of a 390px screen, and flips above the anchor when
// there is no room below.

interface PopState {
  anchor: HTMLElement;
  content: ReactNode;
  pinned: boolean;
}

interface PopApi {
  show: (anchor: HTMLElement, content: ReactNode, pinned: boolean) => void;
  hide: (anchor: HTMLElement) => void;
  close: () => void;
  current: () => PopState | null;
}

const PopCtx = createContext<PopApi | null>(null);

export function PopProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<PopState | null>(null);
  const stRef = useRef<PopState | null>(null);
  stRef.current = st;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // a tap on a phone opens a bottom sheet; hover (desktop) keeps the floating card
  const sheet = !!st?.pinned && window.innerWidth <= 640;

  const api = useRef<PopApi>({
    show: (anchor, content, pinned) => setSt({ anchor, content, pinned }),
    hide: (anchor) => setSt((s) => (s && s.anchor === anchor && !s.pinned ? null : s)),
    close: () => setSt(null),
    current: () => stRef.current,
  }).current;

  useLayoutEffect(() => {
    if (!st || !box.current) return setPos(null);
    const r = st.anchor.getBoundingClientRect();
    const w = box.current.offsetWidth;
    const h = box.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    let top = r.bottom + 8;
    if (top + h > vh - 8 && r.top - h - 8 > 8) top = r.top - h - 8;
    setPos({ left, top });
  }, [st]);

  // a pinned popover closes on a tap elsewhere, on scroll, or on Escape
  useEffect(() => {
    if (!st) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (box.current?.contains(t) || st.anchor.contains(t)) return;
      setSt(null);
    };
    const onScroll = (e: Event) => {
      if (box.current?.contains(e.target as Node)) return;
      setSt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSt(null);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, [st]);

  return (
    <PopCtx.Provider value={api}>
      {children}
      {st &&
        createPortal(
          <div
            ref={box}
            className={`od-pop${sheet ? ' sheet' : ''}`}
            role="tooltip"
            style={sheet ? undefined : pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
          >
            {st.content}
          </div>,
          document.body,
        )}
    </PopCtx.Provider>
  );
}

/** Props that make any element open `render()` in the shared popover. */
export function usePop() {
  const api = useContext(PopCtx)!;
  return useCallback(
    (render: () => ReactNode) => ({
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
        if (!api.current()?.pinned) api.show(e.currentTarget, render(), false);
      },
      onMouseLeave: (e: React.MouseEvent<HTMLElement>) => api.hide(e.currentTarget),
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        const cur = api.current();
        if (cur?.pinned && cur.anchor === e.currentTarget) api.close();
        else api.show(e.currentTarget, render(), true);
      },
    }),
    [api],
  );
}

/** A small ⓘ that explains the thing next to it. */
export function Info({ children, label = 'How this works' }: { children: () => ReactNode; label?: string }) {
  const pop = usePop();
  return (
    <button type="button" className="od-info" aria-label={label} {...pop(children)}>
      i
    </button>
  );
}
