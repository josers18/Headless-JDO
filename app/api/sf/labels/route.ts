import { ensureFreshToken } from "@/lib/salesforce/token";
import { sameSalesforceRecordId } from "@/lib/salesforce/sameRecordId";
import { log } from "@/lib/log";

const API_VER = "v59.0";

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

  const baseUrl = token.instance_url.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token.access_token}` };

  for (const [pre, ids] of byPrefix) {
    const cfg = PREFIX_CONFIG[pre];
    if (!cfg || ids.length === 0) continue;
    const inList = ids.map(soqlQuoteId).join(",");
    const field = cfg.nameField;
    const soql = `SELECT Id, ${field} FROM ${cfg.object} WHERE Id IN (${inList})`;
    try {
      const url = `${baseUrl}/services/data/${API_VER}/query?q=${encodeURIComponent(soql)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        log.warn("sf_labels_query_failed", {
          status: res.status,
          object: cfg.object,
        });
        continue;
      }
      const json = (await res.json()) as {
        records?: Array<{ Id?: string; Name?: string; Subject?: string }>;
      };
      for (const r of json.records ?? []) {
        const rid = r.Id;
        if (!rid) continue;
        const name =
          typeof r.Name === "string"
            ? r.Name
            : typeof r.Subject === "string"
              ? r.Subject
              : "";
        const label = name.trim();
        if (!label) continue;
        labels[rid] = label;
        for (const req of ids) {
          if (sameSalesforceRecordId(rid, req)) labels[req] = label;
        }
      }
    } catch (e) {
      log.warn("sf_labels_fetch_error", {
        object: cfg.object,
        err: String(e),
      });
    }
  }

  return Response.json({ labels });
}
