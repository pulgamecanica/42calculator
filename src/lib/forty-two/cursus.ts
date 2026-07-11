import { auth } from "@/auth";
import type { FortyTwoCursus } from "@/types/forty-two";
import { kv } from "@vercel/kv";

export async function getFortyTwoCursus(): Promise<FortyTwoCursus | undefined> {
  "use server";
  const session = await auth();

  let cursus: FortyTwoCursus | undefined;
  try {
    cursus = (await kv.get(`cursus:${session?.user.login}`)) ?? undefined;
  } catch (error) {
    // This runs during Server Component render, so we cannot mutate cookies
    // here (e.g. via signOut()). Fail gracefully and let the caller render
    // without a cursus instead of crashing the page.
    process.stderr.write(`Error getting cursus: ${error}\n`);
  }

  return cursus;
}
