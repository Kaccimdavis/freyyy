import { LegalShell, LegalSection, SupportContact } from "@/components/LegalShell";

export const metadata = { title: "About — Freyr" };
export const dynamic = "force-dynamic";

export default function AboutPage() {
  return <LegalShell title="About">
    <LegalSection heading="Freyr Trading Intelligence"><p>A gold-first workspace for chart review, signal tracking and market research. Freyr does not hold funds, manage accounts, or guarantee trading outcomes.</p></LegalSection>
    <LegalSection heading="Data sources"><p>The primary gold reference is Hyperliquid’s PAXG market. Selected forex and indices use reference data from Yahoo Finance. The economic calendar uses Forex Factory’s weekly feed. ModFlow derives volume estimates from candles and uses order-book snapshots where available.</p></LegalSection>
    <LegalSection heading="Workspace operator"><SupportContact /></LegalSection>
  </LegalShell>;
}
