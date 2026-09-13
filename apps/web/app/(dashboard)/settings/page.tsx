import { getDb } from "@/db";
import { requireSession } from "@/session";
import { readReviewSettings, readRunnerSettings } from "@/user-settings";
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
    />
  );
}
