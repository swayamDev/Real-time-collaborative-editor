import { passAllowsSeat } from "@/server/demo-pass";
import { DEMO_COOKIE, demoTokenFor, readDemoPass } from "@/server/demo";
import { isSameOrigin } from "@/server/same-origin";

/**
 * A sync token for one demo seat, for the visitor holding that demo's pass
 * (the brahma-demo cookie). Same answers as the document token route:
 *   200 { token, role, expiresIn }
 *   403 cross-site request    404 no pass, or not this pass's seat
 *   410 the demo has ended     429 too many tokens
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const seat = new URL(request.url).searchParams.get("seat") ?? "";
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEMO_COOKIE}=`))
    ?.slice(DEMO_COOKIE.length + 1);
  const pass = readDemoPass(cookie);
  if (!pass || !passAllowsSeat(pass, seat)) return Response.json({ error: "Not found" }, { status: 404 });

  const result = await demoTokenFor(pass, seat);
  if (!result.ok) return Response.json({ error: "Unavailable" }, { status: result.status });
  return Response.json(
    { token: result.token, role: "editor", expiresIn: result.expiresIn },
    { headers: { "Cache-Control": "no-store" } },
  );
}
