import Link from "next/link";
import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import { getCurrentSession } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1">{value}</Typography>
    </Box>
  );
}

export default async function AccountPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  const { email, name } = session.user;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "transparent", position: "relative", zIndex: 2 }}>
      <AppHeader />
      <Container maxWidth="sm" sx={{ py: 5 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h3" component="h1">
              Account
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your account details.
            </Typography>
          </Box>

          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2} divider={<Divider flexItem />}>
                <Field label="Name" value={name?.trim() || "Not set"} />
                <Field label="Email" value={email} />
              </Stack>
            </CardContent>
          </Card>

          <Button component={Link} href="/" variant="text" sx={{ alignSelf: "flex-start" }}>
            Back to dashboard
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
