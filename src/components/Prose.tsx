import type { ReactNode } from 'react';

/** Long-form page shell with a table of contents and readable typography (no Tailwind typography plugin). */
export function Prose({ title, lead, toc, children }: { title: string; lead?: string; toc?: Array<[string, string]>; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {lead && <p className="mt-2 max-w-2xl text-muted">{lead}</p>}
      <div className="mt-8 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
        {toc ? <nav aria-label="On this page" className="hidden lg:block"><ul className="sticky top-20 space-y-1 text-sm">{toc.map(([id, label]) => <li key={id}><a href={`#${id}`} className="block rounded px-2 py-1 text-muted hover:text-fg">{label}</a></li>)}</ul></nav> : <div className="hidden lg:block" />}
        <article className="min-w-0 max-w-3xl space-y-8 text-[15px] leading-7 [&_a]:text-accent-fg-fg [&_a:hover]:underline [&_code]:break-words [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_dd]:mb-3 [&_dd]:text-muted [&_dt]:font-medium [&_h2]:mb-3 [&_h2]:scroll-mt-20 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p+p]:mt-3 [&_section>p]:text-muted [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-6 [&_li]:text-muted">{children}</article>
      </div>
    </div>
  );
}
