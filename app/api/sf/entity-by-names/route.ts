// SOQL via MCP only (no chat model; secondary inference routing does not apply).
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runSoqlViaMcp } from "@/lib/salesforce/mcpQuery";
import { log } from "@/lib/log";

function soqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

type Row = {
  type: "Contact" | "Account";
  Id: string;
  Name: string;
};

type Entity = { client_id: string; client_name: string };

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Prefer exact / same-first+last over loose substring matches. */
function scoreMatch(request: string, sfName: string): number {
  const a = norm(request);
  const b = norm(sfName);
  if (a === b) return 100;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  if (aParts.length >= 2 && bParts.length >= 2) {
    const af = aParts[0]!;
    const al = aParts[aParts.length - 1]!;
    const bf = bParts[0]!;
    const bl = bParts[bParts.length - 1]!;
    if (af === bf && al === bl) return 96;
  }
  if (b.startsWith(a) || a.startsWith(b)) return 85;
  if (b.includes(a) || a.includes(b)) return 72;
  const tokens = a.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length && tokens.every((t) => b.includes(t))) return 58;
  return 0;
}

function pickBestRow(
  request: string,
  rows: Row[],
  minScore: number
): Row | null {
  let best: { row: Row; score: number } | null = null;
  for (const row of rows) {
    const score = scoreMatch(request, row.Name);
    if (score < minScore) continue;
    if (!best || score > best.score) {
      best = { row, score };
    } else if (score === best.score) {
      if (row.type === "Contact" && best.row.type === "Account") {
        best = { row, score };
      }
    }
  }
  return best?.row ?? null;
}

function readString(rec: Record<string, unknown>, field: string): string | undefined {
  const v = rec[field];
  if (typeof v === "string") return v;
  return undefined;
}

function rowsFromSoql(
  records: Array<Record<string, unknown>>,
  type: Row["type"]
): Row[] {
  const out: Row[] = [];
  for (const r of records) {
    const id = readString(r, "Id");
    const nm = readString(r, "Name");
    if (!id || !nm) continue;
    out.push({ type, Id: id, Name: nm.trim() });
  }
  return out;
}

/**
 * SOQL-only entity resolution via the salesforce_crm MCP server (our ECA is
 * `mcp_api` scoped only, so direct REST / SOSL calls 401). We run two tight
 * Name-LIKE queries (Contact, Account) instead of SOSL so we stay inside the
 * MCP lane.
 */
export async function POST(req: Request) {
  const token = await ensureFreshToken();
  if (!token) {
    return Response.json({ entities: [] }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { names?: unknown } | null;
  const raw = Array.isArray(body?.names)
    ? body.names.filter((x): x is string => typeof x === "string")
    : [];
  const unique = [...new Set(raw.map((s) => s.trim()).filter(Boolean))].slice(0, 12);
  if (unique.length === 0) {
    return Response.json({ entities: [] });
  }

  const inList = unique.map(soqlQuote).join(",");
  const likeClauses = unique
    .map((n) => `Name LIKE '${n.replace(/'/g, "''")}%'`)
    .join(" OR ");
  const allRows: Row[] = [];

  const runOne = async (
    obj: Row["type"],
    soql: string
  ): Promise<Row[]> => {
    try {
      const records = await runSoqlViaMcp(token.access_token, soql);
      return rowsFromSoql(records, obj);
    } catch (e) {
      log.warn("sf_entity_by_name_query_failed", {
        object: obj,
        err: String(e),
      });
      return [];
    }
  };

  const exactContact = `SELECT Id, Name FROM Contact WHERE Name IN (${inList}) LIMIT 50`;
  const exactAccount = `SELECT Id, Name FROM Account WHERE Name IN (${inList}) LIMIT 50`;
  const [ec, ea] = await Promise.all([
    runOne("Contact", exactContact),
    runOne("Account", exactAccount),
  ]);
  allRows.push(...ec, ...ea);

  const entities: Entity[] = [];
  const seenPair = new Set<string>();
  const pushEntity = (request: string, row: Row) => {
    const key = `${row.Id}\t${norm(request)}`;
    if (seenPair.has(key)) return;
    seenPair.add(key);
    entities.push({ client_id: row.Id, client_name: request.trim() });
  };
  for (const name of unique) {
    const row = pickBestRow(name, allRows, 100);
    if (row) pushEntity(name, row);
  }

  const unresolved = unique.filter((n) => !pickBestRow(n, allRows, 100));
  if (unresolved.length > 0 && likeClauses.length < 3000) {
    const likeContact = `SELECT Id, Name FROM Contact WHERE ${likeClauses} LIMIT 50`;
    const likeAccount = `SELECT Id, Name FROM Account WHERE ${likeClauses} LIMIT 50`;
    const [lc, la] = await Promise.all([
      runOne("Contact", likeContact),
      runOne("Account", likeAccount),
    ]);
    const likeRows = [...lc, ...la];
    for (const name of unresolved) {
      const row = pickBestRow(name, likeRows, 58);
      if (row) pushEntity(name, row);
    }
  }

  return Response.json({ entities });
}
