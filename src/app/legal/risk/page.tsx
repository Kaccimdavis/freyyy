import { LegalShell, LegalSection } from "@/components/LegalShell";

export const metadata = { title: "Risk disclaimer — Freyr" };

export default function RiskPage() {
  return <LegalShell title="Risk disclaimer">
    <LegalSection heading="Trading can result in loss"><p>Gold, forex, indices and crypto are volatile. Leverage magnifies both gains and losses; some products can lose more than your initial investment. Do not trade with money you cannot afford to lose.</p></LegalSection>
    <LegalSection heading="Information, not advice"><p>Signals, news predictions, order-flow estimates and confidence scores are informational. They are not personalized financial or investment advice, guaranteed outcomes, or evidence of an executed trade. Predicted news direction is compared with a measured market move, not trading profit.</p></LegalSection>
    <LegalSection heading="Independent risk controls"><p>Data feeds and alerts can be delayed or interrupted. Signals expire in Freyr, but that does not cancel or close an order elsewhere. Use your broker’s risk controls and consult a qualified adviser when appropriate. Historical simulations omit some real execution conditions and do not predict future results.</p></LegalSection>
  </LegalShell>;
}
