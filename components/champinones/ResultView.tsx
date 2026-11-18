"use client";
import { useEffect, useMemo, useRef } from "react";
import { usePlayer } from "../player/PlayerProvider";
import { renderBody, CHAMP_CSS, INTERACT_JS } from "../../lib/champinones/render";
import type { StoredResult } from "../../lib/champinones/types";

export default function ResultView({ result }: { result: Pick<StoredResult, "data" | "meta" | "question"> & { id?: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const player = usePlayer();
  const html = useMemo(() => renderBody(result), [result]);
  const rtl = result.data.answer_language === "he";
  useEffect(() => {
    const el = ref.current; if (!el) return;
    try { new Function("root", INTERACT_JS)(el); } catch {}
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest?.("[data-play]") as HTMLElement | null;
      if (!b) return;
      e.preventDefault();
      player.playAt(b.dataset.class || "", Number(b.dataset.ms) || 0).catch(() => {});
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  return (
    <>
      <style>{CHAMP_CSS}</style>
      <div ref={ref} className="champ" dir={rtl ? "rtl" : "ltr"} lang={result.data.answer_language} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
