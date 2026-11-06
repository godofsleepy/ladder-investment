"use server";
import { getPool } from "@ladder/db";
import { createAuthCode, validateAuthorize } from "@ladder/oauth";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export async function decide(fd: FormData): Promise<void> {
  const user = await requireUser();
  const field = (name: string) => String(fd.get(name) ?? "") || undefined;
  // Checked again: the form's hidden values come back from the browser.
  const request = await validateAuthorize(getPool(), {
    client_id: field("client_id"),
    redirect_uri: field("redirect_uri"),
    response_type: "code",
    code_challenge: field("code_challenge"),
    code_challenge_method: "S256",
    state: field("state"),
  });
  const target = new URL(request.redirectUri);
  if (request.state) target.searchParams.set("state", request.state);
  if (fd.get("decision") === "allow") target.searchParams.set("code", await createAuthCode(getPool(), request, user.id));
  else target.searchParams.set("error", "access_denied");
  redirect(target.toString());
}
