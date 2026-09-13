import { getDb } from "@/db";
import { requireSession } from "@/session";
import { readReviewSettings } from "@/user-settings";
import { ReviewsForm } from "./reviews-form";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const session = await requireSession();
  const settings = await readReviewSettings(getDb(), session.user.id);
  return <SettingsView reviews={<ReviewsForm settings={settings} />} />;
}
