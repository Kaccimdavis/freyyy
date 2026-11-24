import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const links = [["/legal/about", "About"], ["/help", "Help & support"], ["/legal/risk", "Risk disclaimer"], ["/legal/privacy", "Privacy policy"], ["/legal/terms", "Terms of use"], ["/legal/refund", "Refund policy"]] as const;

export function SupportContact() {
  const email = process.env.FREYR_SUPPORT_EMAIL?.trim();
  if (email && /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) return <p>Contact the workspace operator at <a className="freyr-link underline underline-offset-2" href={`mailto:${email}`}>{email}</a>. Never include a password, broker key, or card details.</p>;
  return <p>This deployment hasn’t published a support address. Contact the administrator who gave you access to this workspace. For a payment, use the seller or billing contact on your receipt.</p>;
}

export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return <div className="min-h-screen bg-canvas text-ink">
    <header className="liquid-glass sticky top-0 z-10 border-b border-ink/[0.07]"><div className="mx-auto flex h-14 max-w-[660px] items-center justify-between px-5"><Link href="/#settings" className="inline-flex min-h-10 items-center gap-2 text-[13px] font-medium text-ink"><ArrowLeft size={16} aria-hidden="true" /> Settings</Link><span className="font-semibold tracking-tight">Freyr</span></div></header>
    <main className="mx-auto max-w-[660px] px-5 py-8">
      <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.035em]">{title}</h1>
      <div className="mt-6 space-y-3.5">{children}</div>
      <nav aria-label="Legal and support" className="mt-7 flex flex-wrap gap-x-4 gap-y-3 border-t border-ink/[0.08] pt-4 text-[13px] text-ink-secondary">{links.filter(([, label]) => label.toLowerCase() !== title.toLowerCase()).map(([url, label]) => <Link key={url} href={url} className="underline-offset-2 hover:underline">{label}</Link>)}</nav>
    </main>
  </div>;
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return <section className="freyr-panel p-4 sm:p-5"><h2 className="text-[15px] font-semibold text-ink">{heading}</h2><div className="mt-1.5 space-y-2 break-words text-[13px] leading-relaxed text-ink-secondary">{children}</div></section>;
}
