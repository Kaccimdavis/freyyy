import { LegalShell, LegalSection, SupportContact } from "@/components/LegalShell";

export const metadata = { title: "Refund policy — Freyr" };
export const dynamic = "force-dynamic";

export default function RefundPage() {
  return <LegalShell title="Refund policy">
    <LegalSection heading="No charges in this workspace"><p>This version of Freyr does not take payments, renew subscriptions, or store payment details. There is no Freyr checkout charge here to cancel or refund. A workspace tier label is not a billing record.</p></LegalSection>
    <LegalSection heading="If you bought access elsewhere"><p>Check your receipt for the seller, purchase date and order reference. Request cancellation or a refund directly from the seller or the store listed on the receipt. This workspace has no access to that seller’s payment system and can’t issue its refunds. The seller’s purchase terms and applicable consumer law determine eligibility.</p></LegalSection>
    <LegalSection heading="Trading losses and consumer rights"><p>A trading loss, broker fee or missed signal is not a charge made by this workspace. Nothing on this page limits statutory cancellation or refund rights.</p><SupportContact /></LegalSection>
  </LegalShell>;
}
