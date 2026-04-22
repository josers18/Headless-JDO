import { NextResponse } from "next/server";
import { isOnyxInferenceConfigured } from "@/lib/llm/inferenceClients";

export const runtime = "nodejs";

export async function GET() {
  const kimiFallbackConfigured = isOnyxInferenceConfigured();

  return NextResponse.json({
    status: "ok",
    app: "horizon",
    time: new Date().toISOString(),
    inference: {
      kimiFallbackConfigured,
      /** @deprecated Route-based Onyx routing removed — kept false for older monitors. */
      secondaryConfigured: kimiFallbackConfigured,
    },
  });
}
