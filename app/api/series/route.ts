import { NextResponse } from "next/server";
import { publishedSeries } from "../../../lib/series";

export const dynamic = "force-dynamic";
/** Published series (for the collection filter of search, chat and champiñones). */
export async function GET() { return NextResponse.json({ series: publishedSeries() }); }
