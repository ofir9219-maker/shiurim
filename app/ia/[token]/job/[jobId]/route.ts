import { jobPage, jobPost } from "@/lib/zone/pages";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string; jobId: string }> };
export async function GET(req: Request, ctx: Ctx) { const p = await ctx.params; return jobPage(req, p.token, p.jobId); }
export async function POST(req: Request, ctx: Ctx) { const p = await ctx.params; return jobPost(req, p.token, p.jobId); }
