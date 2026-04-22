import { NextResponse } from "next/server";
import {
  DEFAULT_ONYX_ROUTE_LIST,
} from "@/lib/llm/inferenceClients";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET() {
  const onyxUrl = optionalEnv("HEROKU_INFERENCE_ONYX_URL");
  const onyxKey = optionalEnv("HEROKU_INFERENCE_ONYX_KEY");
  const secondaryConfigured = Boolean(onyxUrl?.trim() && onyxKey?.trim());
  const secondaryRoutes = optionalEnv(
    "HEROKU_INFERENCE_ONYX_ROUTES",
    DEFAULT_ONYX_ROUTE_LIST
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return NextResponse.json({
    status: "ok",
    app: "horizon",
    time: new Date().toISOString(),
    inference: {
      secondaryConfigured,
      secondaryRoutes,
    },
  });
}
