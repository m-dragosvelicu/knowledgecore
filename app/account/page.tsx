import Link from "next/link";
import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { GATE_REDIRECT } from "@/lib/auth-guards";
import AppHeader from "@/components/AppHeader";
import { Eyebrow, WobbleButton } from "@/components/ui";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Eyebrow sx={{ mb: "4px" }}>{label}</Eyebrow>
      <Box sx={{ fontSize: 16, color: "var(--ink)" }}>{value}</Box>
    </Box>
  );
}

export default async function AccountPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);
  const { email, name } = session.user;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "transparent", position: "relative", zIndex: 2 }}>
      <AppHeader />

      <Box
        component="main"
        sx={{
          maxWidth: 1060,
          mx: "auto",
          px: { xs: "22px", sm: "40px" },
          pb: { xs: "80px", sm: "100px" },
        }}
      >
        <Box sx={{ maxWidth: 560 }}>
          <Box className="kc-fade" sx={{ mb: "26px", animationDelay: ".06s" }}>
            <Eyebrow sx={{ mb: "12px" }}>Your account</Eyebrow>
            <Box
              component="h1"
              sx={{
                m: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 400,
                fontSize: "clamp(34px, 4.4vw, 48px)",
                lineHeight: 1.06,
                letterSpacing: "-.02em",
                fontVariationSettings: '"SOFT" 20, "opsz" 144',
                color: "var(--ink)",
              }}
            >
              Account
            </Box>
            <Box sx={{ mt: "8px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}>
              The details you signed up with.
            </Box>
          </Box>

          <Card
            className="kc-fade"
            variant="outlined"
            sx={{ borderRadius: "var(--r-lg)", animationDelay: ".16s" }}
          >
            <CardContent sx={{ p: "26px 28px" }}>
              <Stack spacing="22px" divider={<Divider flexItem sx={{ borderColor: "var(--line)" }} />}>
                <Field label="Name" value={name?.trim() || "Not set"} />
                <Field label="Email" value={email} />
              </Stack>
            </CardContent>
          </Card>

          <Box className="kc-fade" sx={{ mt: "26px", animationDelay: ".22s" }}>
            <Box component={Link} href="/" sx={{ textDecoration: "none", display: "inline-flex" }}>
              <WobbleButton bare>Back to your journeys</WobbleButton>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
