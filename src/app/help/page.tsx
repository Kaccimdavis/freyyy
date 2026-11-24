import Link from "next/link";
import { LegalShell, LegalSection, SupportContact } from "@/components/LegalShell";

export const metadata = { title: "Help & support — Freyr" };
export const dynamic = "force-dynamic";

export default function HelpPage() {
  return <LegalShell title="Help & support">
    <LegalSection heading="Signals and alerts"><p>A workspace can publish one open signal at a time. A call stops being tracked three hours after publication at the latest. The next call can be published 15 minutes after the previous call closes or expires.</p><p>To see alerts, open the bell in Freyr. In Settings, choose which alerts to receive and allow browser notifications if your browser supports them. Keep Freyr open to receive browser alerts; monitoring frequency depends on the deployment.</p></LegalSection>
    <LegalSection heading="Review a chart"><p>In Analyze, upload a supported image and confirm the market, timeframe and chart time. ModFlow queries the market feed for that window. Sign in to keep the image and its market snapshot in Analysis History.</p></LegalSection>
    <LegalSection heading="Account and billing"><p>If you still know your password, change it from Settings. If you’re locked out, speak to your workspace administrator. For financial charges, first check the <Link href="/legal/refund" className="freyr-link underline">Refund policy</Link>.</p><SupportContact /></LegalSection>
  </LegalShell>;
}
