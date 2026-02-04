import { generateId, hashObject, nowISO } from "../../../lib/utils";
import type { D1Client, ToolLogEntry } from "../client";

export async function insertToolLog(
  db: D1Client,
  entry: {
    request_id: string;
    tool_name: string;
    input: unknown;
    output?: unknown;
    error?: unknown;
    latency_ms?: number;
    provider_calls?: number;
  }
): Promise<string> {
  const id = generateId();
  const inputJson = JSON.stringify(entry.input);
  const inputHash = hashObject(entry.input);

  await db.run(
    `INSERT INTO tool_logs (id, request_id, tool_name, input_hash, input_json, output_json, error_json, latency_ms, provider_calls, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.request_id,
      entry.tool_name,
      inputHash,
      inputJson,
      entry.output ? JSON.stringify(entry.output) : null,
      entry.error ? JSON.stringify(entry.error) : null,
      entry.latency_ms ?? null,
      entry.provider_calls ?? 0,
      nowISO(),
    ]
  );

  return id;
}

export async function getToolLogs(
  db: D1Client,
  params: {
    tool_name?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<ToolLogEntry[]> {
  const { tool_name, limit = 100, offset = 0 } = params;

  if (tool_name) {
    return db.execute<ToolLogEntry>(
      `SELECT * FROM tool_logs WHERE tool_name = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [tool_name, limit, offset]
    );
  }

  return db.execute<ToolLogEntry>(`SELECT * FROM tool_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
}

export async function getToolLogsByRequestId(db: D1Client, requestId: string): Promise<ToolLogEntry[]> {
  return db.execute<ToolLogEntry>(`SELECT * FROM tool_logs WHERE request_id = ? ORDER BY created_at ASC`, [requestId]);
}
