import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import { getCurrentSession } from "@/lib/auth";
import { currentAdminSession } from "@/lib/auth-guards";
import AppHeader from "@/components/AppHeader";
import { Eyebrow } from "@/components/ui";
import LlmCostsDashboard from "./_components/LlmCostsDashboard";

/**
 * Internal ops page: per-journey and per-user LLM cost reporting. Not linked
 * from any product nav — reached directly by an allow-listed admin. Plain
 * layout (MUI + the design system's tokens only, no marketing-surface
 * flourish) per this page's own scope.
 */
export default async function LlmCostsPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  const admin = await currentAdminSession();

  return (
    <Box sx={{ minHeight: "100vh", position: "relative", zIndex: 2 }}>
      <AppHeader />
      <Box
        component="main"
        sx={{
          maxWidth: 1200,
          mx: "auto",
          px: { xs: "22px", sm: "40px" },
          pb: "100px",
        }}
      >
        <Box sx={{ mb: "24px" }}>
          <Eyebrow sx={{ mb: "8px" }}>Ops</Eyebrow>
          <Box
            component="h1"
            sx={{
              m: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 400,
              fontSize: "clamp(28px, 3.4vw, 38px)",
              lineHeight: 1.1,
              letterSpacing: "-.02em",
              color: "var(--ink)",
            }}
          >
            LLM cost report
          </Box>
        </Box>

        {!admin ? (
          <Box sx={{ fontSize: 15, color: "var(--ink-2)" }}>
            This account is not on the ops allowlist. If you believe this is
            wrong, ask the person who set <code>ADMIN_EMAILS</code> to add
            your email.
          </Box>
        ) : (
          <LlmCostsDashboard />
        )}
      </Box>
    </Box>
  );
}
