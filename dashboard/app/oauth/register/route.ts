import { handleRegister } from "@ladder/http";

export const POST = (req: Request) => handleRegister(req);
