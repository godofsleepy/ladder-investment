import { protectedResourceMetadata } from "@ladder/oauth";
import { baseFrom } from "@/lib/cookies";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => Response.json(protectedResourceMetadata(baseFrom(req.headers)));
