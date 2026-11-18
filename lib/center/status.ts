// File status shown in the Drive browser, derived from the pipeline state + the files next to the audio in Drive.
import type { Item } from "../ingest/state";

export type StatusKey = "none" | "queued" | "transcribing" | "transcribed" | "polishing" | "polished" | "pending_package" | "error";
export const STATUS_LABEL: Record<StatusKey, string> = {
  none: "sin transcribir", queued: "en cola", transcribing: "transcribiendo", transcribed: "transcrito", polishing: "pulido en curso",
  polished: "pulido", pending_package: "paquete pendiente", error: "error",
};
export function statusOf(o: { item?: Item; inInventory?: boolean; hasJson?: boolean; hasMd?: boolean }): StatusKey {
  const it = o.item;
  if (it) {
    if (it.status === "failed") return "error";
    if (it.status === "waiting") return "pending_package";
    if (it.status === "done" || it.state === "indexed") return (it.cfg?.postprocess ?? "openai") === "none" ? "transcribed" : "polished";
    if (it.status === "queued" && it.error) return "error";
    if (it.status === "queued") return "queued";
    // running
    return it.state === "transcribed" || it.state === "polished" ? "polishing" : "transcribing";
  }
  if (o.inInventory) return "polished";
  if (o.hasJson || o.hasMd) return "transcribed";
  return "none";
}
