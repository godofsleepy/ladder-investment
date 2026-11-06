"use client";
import { READ_TOOLS, WRITE_TOOLS } from "@ladder/tool-names";
import { useState, useTransition } from "react";
import { newToken, revokeAssistant, savePreference } from "@/app/(app)/account/actions";
import { Segmented } from "./Segmented";
import { useToast } from "@/components/Toast";

export interface Assistant {
  id: number;
  kind: "token" | "oauth";
  name: string;
  meta: string;
}

type ClientTab = "claude" | "code" | "other";

function clientGuide(url: string, isPrivate: boolean) {
  return {
    claude: {
      help: isPrivate
        ? "Claude's web and phone apps connect from the internet, so they can't reach this private address. Use Claude Code on a device in your tailnet, or put Ladder on a public address first."
        : "In Claude, open Settings › Connectors › Add custom connector, paste the URL and sign in to Ladder.",
      code: url,
    },
    code: {
      help: "Run this in your terminal, then sign in to Ladder when the browser opens.",
      code: `claude mcp add --transport http ladder ${url}`,
    },
    other: {
      help: "For clients that take a config file, create an access token below and paste it in.",
      code: JSON.stringify({ mcpServers: { ladder: { url, headers: { Authorization: "Bearer <your token>" } } } }, null, 2),
    },
  };
}

export function Assistants({
  url,
  isPrivate,
  access: initialAccess,
  assistants,
}: {
  url: string;
  isPrivate: boolean;
  access: "ro" | "rw";
  assistants: Assistant[];
}) {
  const [client, setClient] = useState<ClientTab>("claude");
  const [access, setAccess] = useState(initialAccess);
  const [fresh, setFresh] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { say, toast } = useToast();
  const guide = clientGuide(url, isPrivate)[client];
  const readOnly = access === "ro";

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(done);
    } catch {
      say("Couldn't copy. Select the text and copy it by hand.");
    }
  }

  const tools = [
    ...READ_TOOLS.map((name) => ({ name, kind: "Read", on: true })),
    ...WRITE_TOOLS.map((name) => ({ name, kind: "Write", on: !readOnly })),
  ];

  return (
    <section id="assistants" aria-labelledby="assistants-title" className="card flex scroll-mt-6 flex-col gap-[18px] p-5">
      <div className="flex flex-col gap-1">
        <h2 id="assistants-title" className="m-0 text-[17px] font-bold">AI assistants</h2>
        <p className="m-0 text-[13px] leading-normal text-ink-2">
          Connect Claude, ChatGPT, Codex or any MCP client to your Ladder. The assistant reads and updates your data through Ladder's MCP tools; Ladder does all the maths. Each connection only sees your account.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Your MCP server URL</span>
        <div className="flex items-center gap-2">
          <code className="flex h-10 min-w-0 flex-1 items-center overflow-hidden rounded-[10px] bg-fill px-3 font-mono text-[13px] text-ellipsis whitespace-nowrap">{url}</code>
          <button type="button" onClick={() => copy(url, "Server URL copied")} className="h-10 rounded-[10px] border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-hover">Copy</button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-xs font-semibold text-muted">How to connect</span>
        <div className="self-start">
          <Segmented
            label="Client"
            role="tab"
            value={client}
            options={[{ value: "claude", label: "Claude" }, { value: "code", label: "Claude Code" }, { value: "other", label: "Other clients" }]}
            onPick={setClient}
          />
        </div>
        <p className="m-0 text-[13px] leading-normal text-ink-2">{guide.help}</p>
        <pre className="m-0 rounded-xl bg-[#0b1f3a] px-3.5 py-3 font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-[#e6edf6]">{guide.code}</pre>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line-soft pt-3.5">
        <span className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">What assistants can do</span>
          <span className="text-[13px] text-muted">
            {readOnly ? "Assistants can look at your portfolio but cannot change anything." : "Assistants can also log trades, edit your watchlist, theses and notes."}
          </span>
        </span>
        <Segmented
          label="Assistant access"
          value={access}
          options={[{ value: "ro", label: "Read only" }, { value: "rw", label: "Read & write" }]}
          onPick={(value) => {
            setAccess(value);
            startTransition(async () => {
              await savePreference({ mcp_access: value });
              say(value === "ro" ? "Assistants are now read only" : "Assistants can now read and write");
            });
          }}
        />
      </div>

      <ul aria-label="Tools" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {tools.map((tool) => (
          <li
            key={tool.name}
            title={`${tool.kind}${tool.on ? "" : ", off"}`}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-mono text-xs ${tool.on ? "bg-fill text-ink" : "text-muted line-through"}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${!tool.on ? "bg-line" : tool.kind === "Read" ? "bg-brand" : "bg-warn"}`} />
            {tool.name}
          </li>
        ))}
      </ul>

      <div className="flex flex-col">
        <div className="flex items-center justify-between pb-1.5">
          <span className="text-xs font-semibold text-muted">Connected assistants</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setFresh(await newToken());
              })
            }
            className="min-h-11 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand hover:bg-brand-dark disabled:opacity-60 sm:min-h-8"
          >
            New access token
          </button>
        </div>

        {fresh ? (
          <div role="status" className="mb-2 flex flex-col gap-2 rounded-xl bg-brand-soft p-3">
            <span className="text-[13px] font-semibold">Copy this token now. Ladder will not show it again.</span>
            <div className="flex gap-2">
              <code data-testid="new-token" className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-lg bg-surface px-2.5 font-mono text-[12.5px] text-ellipsis whitespace-nowrap">{fresh}</code>
              <button
                type="button"
                onClick={async () => {
                  await copy(fresh, "Token copied");
                  setFresh(null);
                }}
                className="h-9 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand"
              >
                Copy
              </button>
            </div>
          </div>
        ) : null}

        {assistants.length === 0 ? (
          <p className="m-0 border-t border-line-soft py-3 text-[13px] text-muted">No assistants connected yet.</p>
        ) : (
          <ul aria-label="Connected assistants" className="m-0 list-none p-0">
            {assistants.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 border-t border-line-soft py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-fill text-[13px] font-bold text-ink-2">
                    {a.kind === "oauth" ? a.name.slice(0, 2) : "T"}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">{a.name}</span>
                    <span className="text-xs text-muted">{a.meta}</span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await revokeAssistant(a.id);
                      say(a.kind === "oauth" ? `${a.name} disconnected` : "Token revoked");
                    })
                  }
                  className="min-h-11 rounded-lg bg-fill px-3 text-[13px] font-semibold text-ink sm:min-h-8"
                >
                  {a.kind === "oauth" ? "Disconnect" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {toast}
    </section>
  );
}
