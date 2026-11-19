import * as A from "@/lib/zone/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };
export const OPTIONS = A.OPTIONS;
export async function GET(req: Request, ctx: Ctx) { return A.list(req, await ctx.params); }
