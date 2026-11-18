// Runs the remaining steps of one item, persisting after each transition. Steps are injected (testable).
import { addLog, completeStep, failItem, nextState, type Item, type StepState } from "./state";

export type StepFn = (it: Item) => Promise<void>;
/** Step keyed by the state the item is in when it runs (detected -> uploads, uploaded -> transcribes, ...). */
export type Steps = Record<Exclude<StepState, "indexed">, StepFn>;

export async function runItem(it: Item, steps: Steps, persist: () => void, log: (m: string) => void = () => {}): Promise<void> {
  it.status = "running"; persist();
  try {
    while (it.state !== "indexed") {
      const from = it.state;
      addLog(it, `▶ ${from} → ${nextState(from)}`); persist();
      await steps[from as Exclude<StepState, "indexed">](it);
      completeStep(it);
      addLog(it, `✔ ${it.state}`); persist();
    }
    it.status = "done"; it.finishedAt = new Date().toISOString(); it.error = undefined;
    addLog(it, "clase publicada en el sitio");
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    failItem(it, msg);
    addLog(it, `✘ ${it.state}: ${msg} (intento ${it.attempts}${(it.status as string) === "failed" ? ", sin más reintentos" : ""})`);
    log(`item ${it.id} falló en ${it.state}: ${msg}`);
  }
  persist();
}
