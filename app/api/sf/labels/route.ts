import { ensureFreshToken } from "@/lib/salesforce/token";
import { sameSalesforceRecordId } from "@/lib/salesforce/sameRecordId";
import { runSoqlViaMcp } from "@/lib/salesforce/mcpQuery";
import { log } from "@/lib/log";

const PREFIX_CONFIG: Record<
  string,
  { object: string; nameField: "Name" | "Subject" }
> = {
  "001": { object: "Account", nameField: "Name" },
  "003": { object: "Contact", nameField: "Name" },
  "005": { object: "User", nameField: "Name" },
  "006": { object: "Opportunity", nameField: "Name" },
  "00Q": { object: "Lead", nameField: "Name" },
  "00T": { object: "Task", nameField: "Subject" },
  "00U": { object: "Event", nameField: "Subject" },
  "500": { object: "Case", nameField: "Subject" },
  "800": { object: "Contract", nameField: "Name" },
  "701": { object: "Campaign", nameField: "Name" },
};

function soqlQuoteId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

function readString(rec: Record<string, unknown>, field: string): string | undefined {
  const v = rec[field];
  if (typeof v === "string") return v;
  const lower = rec[field.toLowerCase()];
  if (typeof lower === "string") return lower;
  return undefined;
}

/**
 * Resolves Salesforce Ids to display labels via the salesforce_crm MCP server
 * (NOT direct REST) because our External Client App scope is `mcp_api` only.
 */
export async function POST(req: Request) {
  const token = await ensureFreshToken();
  if (!token) {
    return Response.json({ labels: {} }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const raw = Array.isArray(body?.ids)
    ? body.ids.filter((x): x is string => typeof x === "string")
    : [];
  const unique = [...new Set(raw.map((x) => x.trim()).filter(Boolean))].slice(0, 40);

  const labels: Record<string, string> = {};
  const byPrefix = new Map<string, string[]>();

  for (const id of unique) {
    if (id.length !== 15 && id.length !== 18) continue;
    const pre = id.slice(0, 3);
    if (!PREFIX_CONFIG[pre]) continue;
    const list = byPrefix.get(pre) ?? [];
    list.push(id);
    byPrefix.set(pre, list);
  }

  for (const [pre, ids] of byPrefix) {
    const cfg = PREFIX_CONFIG[pre];
    if (!cfg || ids.length === 0) continue;
    const inList = ids.map(soqlQuoteId).join(",");
    const field = cfg.nameField;
    const soql = `SELECT Id, ${field} FROM ${cfg.object} WHERE Id IN (${inList})`;
    try {
      const records = await runSoqlViaMcp(token.access_token, soql);
      for (const r of records) {
        const rid = readString(r, "Id");
        if (!rid) continue;
        const name =
          readString(r, field) ??
          readString(r, "Name") ??
          readString(r, "Subject") ??
          "";
        const label = name.trim();
        if (!label) continue;
        labels[rid] = label;
        for (const requested of ids) {
          if (sameSalesforceRecordId(rid, requested)) labels[requested] = label;
        }
      }
    } catch (e) {
      log.warn("sf_labels_query_failed", {
        object: cfg.object,
        err: String(e),
      });
    }
  }

  return Response.json({ labels });
}
