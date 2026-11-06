import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { tokenIdentity } from "./auth.js";
import { getPool } from "./db.js";
import { exchangeCode, OAuthError, refreshGrant, registerClient } from "./oauth.js";
import { createServer } from "./tools.js";

const NO_STORE = { "Cache-Control": "no-store" };

function oauthFailure(err: unknown): Response {
  if (err instanceof OAuthError) {
    return Response.json({ error: err.code, error_description: err.message }, { status: err.status, headers: NO_STORE });
  }
  console.error(err);
  return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
}

/** MCP over Streamable HTTP, stateless: one server per request, acting as the token's account. */
export async function handleMcp(req: Request, base: string): Promise<Response> {
  // A web page can reach a local server through the visitor's browser, so a browser Origin must be this site.
  const origin = req.headers.get("origin");
  if (origin && origin !== base) return new Response("Forbidden origin", { status: 403 });

  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? "";
  const identity = token ? await tokenIdentity(getPool(), token) : null;
  if (!identity) {
    return new Response("Sign in to Ladder to use this server", {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` },
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createServer(identity).connect(transport);
  return transport.handleRequest(req);
}

export async function handleToken(req: Request): Promise<Response> {
  try {
    const form = new URLSearchParams(await req.text());
    const field = (name: string) => form.get(name) ?? undefined;
    const grant = field("grant_type");
    if (grant === "authorization_code") {
      const tokens = await exchangeCode(getPool(), {
        code: field("code"),
        client_id: field("client_id"),
        redirect_uri: field("redirect_uri"),
        code_verifier: field("code_verifier"),
      });
      return Response.json(tokens, { headers: NO_STORE });
    }
    if (grant === "refresh_token") {
      const tokens = await refreshGrant(getPool(), { refresh_token: field("refresh_token"), client_id: field("client_id") });
      return Response.json(tokens, { headers: NO_STORE });
    }
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  } catch (err) {
    return oauthFailure(err);
  }
}

export async function handleRegister(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as { client_name?: unknown; redirect_uris?: unknown } | null;
    if (!body) throw new OAuthError("invalid_client_metadata", "Send JSON");
    const client = await registerClient(getPool(), body);
    return Response.json(
      {
        ...client,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (err) {
    return oauthFailure(err);
  }
}
