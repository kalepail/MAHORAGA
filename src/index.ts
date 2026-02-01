import type { Env } from "./env.d";
import { MahoragaMcpAgent } from "./mcp/agent";
import { handleCronEvent } from "./jobs/cron";
import { getTradingAgentStub } from "./durable-objects/trading-agent";

export { SessionDO } from "./durable-objects/session";
export { MahoragaMcpAgent };
export { TradingAgentDO } from "./durable-objects/trading-agent";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "mahoraga",
          version: "0.1.0",
          description: "Cloudflare Workers MCP server for autonomous stock trading",
          endpoints: {
            health: "/health",
            mcp: "/mcp (via Durable Object)",
            agent: "/agent/* (Trading Agent DO)",
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname.startsWith("/mcp")) {
      return MahoragaMcpAgent.mount("/mcp", { binding: "MCP_AGENT" }).fetch(request, env, ctx);
    }

    if (url.pathname.startsWith("/agent")) {
      const stub = getTradingAgentStub(env);
      const agentPath = url.pathname.replace("/agent", "") || "/status";
      const agentUrl = new URL(agentPath, "http://agent");
      agentUrl.search = url.search;
      return stub.fetch(new Request(agentUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }));
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const cronId = event.cron;
    console.log(`Cron triggered: ${cronId} at ${new Date().toISOString()}`);
    ctx.waitUntil(handleCronEvent(cronId, env));
  },
};
