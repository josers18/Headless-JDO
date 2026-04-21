import { ensureFreshToken } from "@/lib/salesforce/token";
import { log } from "@/lib/log";

const API_VER = "v59.0";

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

function tokensForWildcardSosl(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9'-]/g, ""))
    .filter((t) => t.length >= 2)
    .slice(0, 4);
}

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

  const baseUrl = token.instance_url.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const inList = unique.map(soqlQuote).join(",");

  const allRows: Row[] = [];

  const runSoql = async (objectName: "Contact" | "Account") => {
    const soql = `SELECT Id, Name FROM ${objectName} WHERE Name IN (${inList})`;
    try {
      const url = `${baseUrl}/services/data/${API_VER}/query?q=${encodeURIComponent(soql)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        log.warn("sf_entity_by_name_query_failed", {
          object: objectName,
          status: res.status,
        });
        return;
      }
      const json = (await res.json()) as {
        records?: Array<{ Id?: string; Name?: string }>;
      };
      for (const r of json.records ?? []) {
        const id = r.Id;
        const name = r.Name?.trim();
        if (!id || !name) continue;
        allRows.push({ type: objectName, Id: id, Name: name });
      }
    } catch (e) {
      log.warn("sf_entity_by_name_fetch_error", {
        object: objectName,
        err: String(e),
      });
    }
  };

  await runSoql("Contact");
  await runSoql("Account");

  const entities: Entity[] = [];
  const seenPair = new Set<string>();

  const pushEntity = (request: string, row: Row) => {
    const key = `${row.Id}\t${norm(request)}`;
    if (seenPair.has(key)) return;
    seenPair.add(key);
    entities.push({
      client_id: row.Id,
      client_name: request.trim(),
    });
  };

  for (const name of unique) {
    const row = pickBestRow(name, allRows, 100);
    if (row) pushEntity(name, row);
  }

  const runSosl = async (name: string): Promise<Row[]> => {
    const tokens = tokensForWildcardSosl(name);
    if (tokens.length === 0) return [];
    const findClause =
      tokens.length === 1
        ? `{${tokens[0]}*}`
        : tokens.map((t) => `{${t}*}`).join(" AND ");
    const sosl = `FIND ${findClause} IN NAME FIELDS RETURNING Contact(Id, Name), Account(Id, Name) LIMIT 25`;
    try {
      const url = `${baseUrl}/services/data/${API_VER}/search/?q=${encodeURIComponent(sosl)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        log.warn("sf_entity_by_name_sosl_failed", {
          status: res.status,
          nameLen: name.length,
        });
        return [];
      }
      const json = (await res.json()) as {
        searchRecords?: Array<{
          Id?: string;
          Name?: string;
          attributes?: { type?: string };
        }>;
      };
      const out: Row[] = [];
      for (const r of json.searchRecords ?? []) {
        const id = r.Id?.trim();
        const nm = r.Name?.trim();
        const t = r.attributes?.type;
        if (!id || !nm || (t !== "Contact" && t !== "Account")) continue;
        out.push({ type: t, Id: id, Name: nm });
      }
      return out;
    } catch (e) {
      log.warn("sf_entity_by_name_sosl_error", { err: String(e) });
      return [];
    }
  };

  for (const name of unique) {
    if (pickBestRow(name, allRows, 100)) continue;
    const soslRows = await runSosl(name);
    const row = pickBestRow(name, soslRows, 58);
    if (row) pushEntity(name, row);
  }

  return Response.json({ entities });
}
