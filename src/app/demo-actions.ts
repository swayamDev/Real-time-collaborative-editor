"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddress } from "@/server/client-ip";
import { DEMO_COOKIE, startDemo, writeDemoPass } from "@/server/demo";

/** "Start the demo": a new demo document, and its pass in a cookie. */
export async function startDemoAction(): Promise<void> {
  const result = await startDemo(clientAddress(await headers()));
  if (!result.ok) redirect("/demo?busy=1");
  (await cookies()).set(DEMO_COOKIE, writeDemoPass(result.pass), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && (process.env.BETTER_AUTH_URL ?? "").startsWith("https:"),
    sameSite: "lax",
    path: "/",
    expires: new Date(result.pass.expiresAt),
  });
  redirect("/demo");
}
