import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "horizon",
    time: new Date().toISOString(),
  });
}
