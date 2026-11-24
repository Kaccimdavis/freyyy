import { LegalShell, LegalSection, SupportContact } from "@/components/LegalShell";

export const metadata = { title: "Privacy policy — Freyr" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return <LegalShell title="Privacy policy">
    <LegalSection heading="Your account and workspace"><p>Freyr stores the name and email used for your account, a password hash, and your workspace records: settings, alerts, watchlists, analysis, journal and signals. A session cookie keeps you signed in. Your browser also stores your appearance preference to apply it as the page loads.</p></LegalSection>
    <LegalSection heading="Chart uploads"><p>Uploaded screenshots are used for your analysis request. If you are signed in, the image and corresponding market data are saved to your analysis history. Removing the record from History removes its saved image from the workspace.</p><p>If OpenAI chart label reading is available and you explicitly turn it on for an upload, the image is sent to that provider to transcribe chart labels. Otherwise it stays in this workspace’s image-processing flow. Crop any sensitive account information before uploading.</p></LegalSection>
    <LegalSection heading="Your choices"><p>Browser notifications and promotional consent are optional. They can be changed any time in Settings. This deployment records your consent preference; it does not run a promotional mailing service.</p><p>Contact the workspace operator for access to or deletion of your account records, or questions about how this deployment handles data.</p><SupportContact /></LegalSection>
  </LegalShell>;
}
