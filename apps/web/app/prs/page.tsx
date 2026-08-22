import { requireSession } from "@/session";

export default async function PullRequestsPage() {
  const session = await requireSession();
  return (
    <main>
      <h1>Pull requests</h1>
      <p>Signed in as {session.user.name}</p>
      <p>PR list arrives in the next change.</p>
    </main>
  );
}
