import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const root = path.resolve(process.cwd(), "..");

// One .env for the whole project. A DATABASE_URL already set wins.
const envFile = path.join(root, ".env");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const nextConfig: NextConfig = {
  // A small server cannot run the build, so it receives this self-contained bundle instead.
  output: process.env.LADDER_STANDALONE ? "standalone" : undefined,
  // The dashboard imports Ladder's own logic from ../src, so its numbers match the MCP tools.
  experimental: { externalDir: true },
  outputFileTracingRoot: root,
  serverExternalPackages: ["pg", "nodemailer"],
  // The consent page must not be framed, or another site could trick someone into clicking Connect.
  headers: async () => [
    { source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Referrer-Policy", value: "same-origin" }] },
  ],
  // Ladder's source uses NodeNext ".js" import paths for its TypeScript files.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return config;
  },
};

export default nextConfig;
