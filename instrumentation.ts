export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupProxy } = await import("./lib/proxy");
    setupProxy();
  }
}
