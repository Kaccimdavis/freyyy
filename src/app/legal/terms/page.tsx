import Link from "next/link";
import { LegalShell, LegalSection } from "@/components/LegalShell";

export const metadata = { title: "Terms of use — Freyr" };

export default function TermsPage() {
  return <LegalShell title="Terms of use">
    <LegalSection heading="What Freyr provides"><p>Freyr is a research workspace for market data, order-flow estimates, educational signals, journal entries and historical simulation. It is not a broker or an investment adviser. Nothing in the workspace is a personal recommendation or a promise of performance.</p></LegalSection>
    <LegalSection heading="Your account and data"><p>Keep credentials private, and upload only charts you’re authorized to use. Don’t submit account secrets, broker keys or payment details in notes or images. Do not misrepresent signals or predictions as guaranteed outcomes.</p></LegalSection>
    <LegalSection heading="Trading and data availability"><p>Feeds, alerts and derived assessments can be incomplete, delayed or unavailable. Signal deadlines and observed outcomes govern the Freyr record, not orders at your broker. Make independent trading decisions and review the <Link href="/legal/risk" className="freyr-link underline">Risk disclaimer</Link>.</p></LegalSection>
    <LegalSection heading="Payments"><p>No charges are collected by this version of Freyr. See the <Link href="/legal/refund" className="freyr-link underline">Refund policy</Link> if a third-party seller charged you for access. Applicable consumer rights remain unaffected.</p></LegalSection>
  </LegalShell>;
}
