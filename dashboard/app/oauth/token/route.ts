import { handleToken } from "@ladder/http";

export const POST = (req: Request) => handleToken(req);
