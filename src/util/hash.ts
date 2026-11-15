import { createHash } from "node:crypto";
export const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
