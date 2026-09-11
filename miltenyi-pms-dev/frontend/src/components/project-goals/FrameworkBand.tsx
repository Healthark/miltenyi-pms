import { BookOpen } from "lucide-react";
import type { FrameworkRow } from "@/services/project-goals.service";

/**
 * The framework band above the goals table: level title, function, and the
 * two illustrative paragraphs from the Miltenyi document. Read-only; the
 * KPIs themselves are the table rows.
 */
export function FrameworkBand({
  framework,
  kpiCountNote,
}: Readonly<{ framework: FrameworkRow; kpiCountNote?: string }>) {
  return (
    <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-5" aria-label="Framework">
      <div className="flex items-start gap-2.5">
        <BookOpen className="mt-1 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
            Framework · {framework.period_label}
          </p>
          <h2 className="font-display text-base font-semibold text-text-main">
            {framework.title}{" "}
            <span className="font-normal text-text-muted">
              · {framework.function_name} · level {framework.level} of 4
            </span>
          </h2>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-blue-700">Business &amp; strategic outcomes</p>
          <p className="text-[13px] leading-relaxed text-blue-900">{framework.business_outcomes}</p>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-blue-700">Functional / operational excellence goals</p>
          <p className="text-[13px] leading-relaxed text-blue-900">{framework.functional_goals}</p>
        </div>
      </div>
      {kpiCountNote && <p className="mt-3 text-[11px] text-blue-500">{kpiCountNote}</p>}
    </section>
  );
}
