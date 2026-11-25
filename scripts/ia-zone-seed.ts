// Seeds ONE mock job in the AI zone from a real short class (demo / manual QA). Usage:
//   STORAGE_DIR=/tmp/zone AI_ZONE_TOKEN=<token> tsx scripts/ia-zone-seed.ts [segments-json] [order] [name]
// Prints the zone URL (PUBLIC_BASE_URL or http://localhost:3123).
import fs from "node:fs";
import { BERAJOT_TEMPLATE, systemDefaults } from "../lib/center/collections";
import { createJobs } from "../lib/zone/jobs";
import { currentToken, zoneUrl } from "../lib/zone/token";

const file = process.argv[2] || "data/segments/196mMNJsoOgfnU60utfsok4H9zH--XuUU.json";
const order = process.argv[3] || "27";
const name = process.argv[4] || "27. ברכות ז ע''א - בלעם.mp3";
const segments = (JSON.parse(fs.readFileSync(file, "utf8")) as { segments: { startMs: number; endMs: number; text: string }[] }).segments;
const cfg = { ...systemDefaults(), published: false, collectionName: "ברכות שר לשמחה", slug: "berajot", postprocess: "ai_package" as const, namingMode: "template" as const, template: BERAJOT_TEMPLATE };
const it = { id: `demo-${order}`, name, ext: ".mp3", order, fileDate: "2025-03-01T10:00:00Z", collectionId: "demo", parentId: "" } as never;
const jobs = await createJobs(it, cfg, segments);
console.log(`${jobs.length} job(s) creado(s): ${jobs.map((j) => j.id).join(", ")}`);
console.log(zoneUrl(currentToken()!, (process.env.PUBLIC_BASE_URL || "http://localhost:3123").replace(/\/$/, "")));
