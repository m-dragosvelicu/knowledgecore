import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrCreateActiveIntent, nextWizardRoute } from "@/lib/journey/state";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  const intent = await getOrCreateActiveIntent(session.user.id);
  redirect(nextWizardRoute(intent) as never);
}
