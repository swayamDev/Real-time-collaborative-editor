import { NextResponse } from "next/server";
import { DEMO_COOKIE, readDemoPass } from "@/server/demo";

/**
 * Open Visitor B on another device: the join link carries a pass for seat
 * B only, valid for that demo and expiring with it. It becomes this
 * device's demo cookie, then the demo page opens.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const value = url.searchParams.get("pass") ?? "";
  const pass = readDemoPass(value);
  const target = new URL("/demo", url.origin);
  if (!pass || pass.seats !== "b") {
    target.searchParams.set("ended", "1");
    return NextResponse.redirect(target, 303);
  }
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(DEMO_COOKIE, value, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: new Date(pass.expiresAt),
  });
  return response;
}
