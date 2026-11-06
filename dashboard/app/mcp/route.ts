import { handleMcp } from "@ladder/http";
import { baseFrom } from "@/lib/cookies";

export const POST = (req: Request) => handleMcp(req, baseFrom(req.headers));

// No server-initiated streams or sessions: say so, as the MCP spec asks.
const notAllowed = () => new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
export { notAllowed as GET, notAllowed as DELETE };
