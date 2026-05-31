import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { auth, getCurrentSession } from "@/lib/auth";
import { WobbleButton, SkipButton } from "@/components/ui";

// Shared top chrome — the "silent plumbing" tier. Concrete, no hand marks on the
// burger or avatar (those are reserved for the warm/expressive surfaces); a
// quiet hover lift + soft shadow on the burger, a 2px teal ring on the avatar.
// The wordmark is LIVE TYPE (Fraunces 600, SOFT 30, letter-spacing -.015em), not
// an image. Account is a workbench (wobble) action; Sign out is the lightest
// skip tier. Server component: it reads the session and owns the sign-out
// server action so callers do not thread email/handlers through.
//
// Ported from design-system/ui_kits/web-app/Shell.jsx (.top / .burger / .word /
// .avatar) and design-system/source/knowledgecore-home-v4.html.
export default async function AppHeader() {
  const session = await getCurrentSession();
  const name = session?.user?.name?.trim() ?? "";
  const email = session?.user?.email ?? "";
  // Avatar initial: first letter of the name, else the email, else a dot.
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
          {/* Account — workbench (wobble) tier. */}
          <Box
            component={Link}
            href="/account"
            sx={{ textDecoration: "none", display: "inline-flex" }}
          >
            <WobbleButton bare>Account</WobbleButton>
          </Box>

          {/* Sign out — lightest skip tier; the server action lives on the form. */}
          <Box
            component="form"
            action={async () => {
              "use server";
              await auth.api.signOut({ headers: await headers() });
              redirect("/signin");
            }}
            sx={{ display: "inline-flex" }}
          >
            <SkipButton type="submit">Sign out</SkipButton>
          </Box>

          {/* Avatar — concrete plumbing: ink circle, 2px teal ring on hover,
              quiet lift. Links to the account page. */}
          <Box
            component={Link}
            href="/account"
            aria-label="Account"
            sx={{
              width: 46,
              height: 46,
              ml: "10px",
              borderRadius: "50%",
              bgcolor: "var(--ink)",
              color: "var(--surface)",
              display: "grid",
              placeContent: "center",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
              flex: "none",
              border: "2px solid transparent",
              textDecoration: "none",
              transition: ".25s",
              "&:hover": {
                borderColor: "var(--teal)",
                transform: "translateY(-1px)",
              },
            }}
          >
            {initial}
          </Box>
        </Stack>
      </Stack>
    </Box>
  );
}
