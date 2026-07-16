// Auth integration smoke test for the Better Auth email+password flow.
//
// Requires the app to be running locally (e.g. `bun run dev` or `bun run start`)
// and the Postgres dev DB to be up (`bun run db:up`).
//
// Run with: bun run scripts/auth-smoke.ts   (or `bun run test:auth`)
//
// It exercises the real HTTP surface end-to-end: sign-up -> session check ->
// sign-out -> sign-in (correct + wrong password) -> cleanup. Exits non-zero on
// any failed assertion.
import { prisma } from "@/lib/db";

const BASE = process.env.BETTER_AUTH_URL || "http://localhost:3000";
const EMAIL = `auth-smoke+${Date.now()}@example.com`;
const PASSWORD = "password1234";

let passed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  passed++;
  console.log(`  ok - ${msg}`);
}

function getSessionCookie(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(/better-auth\.session_token=[^;]+/);
  return match ? match[0] : null;
}

async function main() {
  console.log(`[auth-smoke] target ${BASE}, email ${EMAIL}`);

  const signUpRes = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Auth Smoke", email: EMAIL, password: PASSWORD }),
  });
  assert(signUpRes.status === 200, `sign-up returns 200 (got ${signUpRes.status})`);
  const cookie = getSessionCookie(signUpRes);
  assert(!!cookie, "sign-up sets a session cookie");

  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { accounts: true, sessions: true },
  });
  assert(!!user, "user row written");
  assert(!!user?.id, "user.id populated");
  assert(
    user!.accounts.some((a) => a.providerId === "credential" && !!a.password),
    "account row has providerId=credential with a non-null password hash"
  );
  assert(user!.sessions.length >= 1, "session row written");

  const sessionRes = await fetch(`${BASE}/api/auth/get-session`, {
    headers: { cookie: cookie! },
  });
  const sessionBody = (await sessionRes.json()) as { user?: { id?: string } } | null;
  assert(
    sessionBody?.user?.id === user!.id,
    "get-session returns the signed-up user.id"
  );

  const signOutRes = await fetch(`${BASE}/api/auth/sign-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookie! },
    body: "{}",
  });
  assert(signOutRes.status === 200, `sign-out returns 200 (got ${signOutRes.status})`);
  const afterOut = await fetch(`${BASE}/api/auth/get-session`, {
    headers: { cookie: cookie! },
  });
  const afterOutBody = await afterOut.text();
  assert(
    afterOutBody.trim() === "null" || afterOutBody.trim() === "",
    "session is gone after sign-out"
  );

  const signInRes = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(signInRes.status === 200, `sign-in (correct pw) returns 200 (got ${signInRes.status})`);

  const badRes = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "totallyWrong999" }),
  });
  assert(badRes.status === 401, `sign-in (wrong pw) is rejected with 401 (got ${badRes.status})`);

  // Cleanup (cascade removes account + sessions)
  await prisma.user.delete({ where: { email: EMAIL } });
  console.log("[auth-smoke] cleaned up test user");
}

main()
  .then(async () => {
    console.log(`[auth-smoke] all ${passed} checks passed`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("[auth-smoke] FAILED:", e instanceof Error ? e.message : e);
    await prisma.user.deleteMany({ where: { email: EMAIL } }).catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });
