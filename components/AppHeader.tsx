import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { auth, getCurrentSession, isAnonymousSession } from "@/lib/auth";
import AccountMenu from "@/components/AccountMenu";

// Shared top chrome — the "plumbing" tier: no hand marks (reserved for the
// warm/expressive surfaces).
//
// Ported from design-system/ui_kits/web-app/Shell.jsx (.top / .burger / .word /
// .avatar) and design-system/source/knowledgecore-home-v4.html.
export default async function AppHeader() {
  const session = await getCurrentSession();
  // A guest (anonymous plugin) has a session but no real account, so it gets the
  // "Sign in" affordance, not the avatar menu. Only a real account sees the
  // AccountMenu (Profile / Sign out).
  const hasRealAccount = !!session?.user?.id && !isAnonymousSession(session);
  const name = session?.user?.name?.trim() ?? "";
  const email = session?.user?.email ?? "";
  const initial = (name || email || "·").slice(0, 1).toUpperCase();

  return (
    // Above the fixed texture layers; centered single column, max-width 1060px,
    // generous padding to match the home/account content column.
    <Box
      component="header"
      sx={{
        position: "relative",
        zIndex: 2,
        maxWidth: 1060,
        mx: "auto",
        px: { xs: "22px", sm: "40px" },
        pt: { xs: "24px", sm: "30px" },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: { xs: "32px", sm: "46px" } }}
      >
        <Stack direction="row" alignItems="center" spacing="20px">
          {/* Burger — concrete plumbing: surface fill, 13px radius, hairline
              border, hover lift + soft shadow. No hand mark. Links home. */}
          <Box
            component={Link}
            href="/"
            aria-label="Home"
            sx={{
              width: 44,
              height: 44,
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--line)",
              bgcolor: "background.paper",
              display: "grid",
              placeContent: "center",
              gap: "4px",
              cursor: "pointer",
              flex: "none",
              transition: ".25s",
              "&:hover": {
                transform: "translateY(-1px)",
                boxShadow: "var(--shadow-sm)",
              },
              "& span": {
                display: "block",
                width: 17,
                height: "1.6px",
                bgcolor: "var(--ink)",
                borderRadius: "2px",
              },
              "& span:nth-of-type(2)": { width: 11 },
            }}
          >
            <span />
            <span />
            <span />
          </Box>

          {/* Wordmark — LIVE TYPE, Fraunces 600 SOFT 30, -.015em. Links home. */}
          <Box
            component={Link}
            href="/"
            sx={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 23,
              letterSpacing: "-.015em",
              fontVariationSettings: '"SOFT" 30',
              color: "var(--ink)",
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            KnowledgeCore
          </Box>
        </Stack>

        <Stack direction="row" alignItems="center" spacing="6px">
          {hasRealAccount ? (
            // Avatar dropdown — the only top-right affordance for a real account.
            // The sign-out server action is bound here and threaded into the
            // client menu.
            <AccountMenu
              initial={initial}
              signOut={async () => {
                "use server";
                await auth.api.signOut({ headers: await headers() });
                redirect("/signin");
              }}
            />
          ) : (
            // Guest / no real account: a quiet "Sign in" link instead of the
            // avatar. Beginning to learn is what asks the visitor to create an
            // account; this is the calm secondary path for a returning customer.
            <Box
              component={Link}
              href="/signin"
              sx={{
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                fontSize: 14.5,
                color: "var(--ink)",
                textDecoration: "none",
                px: "16px",
                py: "9px",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--line)",
                bgcolor: "background.paper",
                transition: ".25s",
                "&:hover": {
                  borderColor: "var(--teal)",
                  color: "var(--teal-deep)",
                  transform: "translateY(-1px)",
                  boxShadow: "var(--shadow-sm)",
                },
              }}
            >
              Sign in
            </Box>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
