import { Suspense } from "react";
import { getDb } from "@/db";
import { requireSession } from "@/session";
import { readReviewSettings, readRunnerSettings } from "@/user-settings";
import { InstalledOn } from "./installed-on";
import { InstalledOnSkeleton } from "./installed-on-view";
import { ReviewsForm } from "./reviews-form";
import { RunnerForm } from "./runner-form";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const session = await requireSession();
  const db = getDb();
  const [reviews, runner] = await Promise.all([
    readReviewSettings(db, session.user.id),
    readRunnerSettings(db, session.user.id),
  ]);
  return (
    <SettingsView
      reviews={<ReviewsForm settings={reviews} />}
      runner={<RunnerForm settings={runner} />}
      installed={
        <Suspense fallback={<InstalledOnSkeleton />}>
          <InstalledOn userId={session.user.id} login={session.user.githubLogin ?? undefined} />
        </Suspense>
      }
    />
  );
}
