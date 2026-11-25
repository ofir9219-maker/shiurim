import crypto from "node:crypto";
export const hashLegacy = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
