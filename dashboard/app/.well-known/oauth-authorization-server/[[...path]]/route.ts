import { authorizationServerMetadata } from "@ladder/oauth";
import { baseFrom } from "@/lib/cookies";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => Response.json(authorizationServerMetadata(baseFrom(req.headers)));
