import { llmsTxt } from "@/lib/zone/pages";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };
export async function GET(req: Request, ctx: Ctx) { return llmsTxt(req, (await ctx.params).token); }
