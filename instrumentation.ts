export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupProxy } = await import("./lib/proxy");
    setupProxy();
    const { startBackgroundUpload } = await import("./lib/r2-sync");
    startBackgroundUpload();
    const { startIngest } = await import("./lib/ingest/scheduler");
    startIngest();
  }
}
