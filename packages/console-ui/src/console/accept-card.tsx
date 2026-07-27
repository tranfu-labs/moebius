import { ExternalLink, Hand } from "lucide-react";

import { translate, useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Input } from "@/ui/input";

export type AcceptanceDecision = "pass" | "fail" | "pending";

export interface AcceptanceItem {
  id: string;
  statement: string;
  decision: AcceptanceDecision;
  evidence?: string;
  artifactLabel?: string;
}

export interface AcceptCardProps {
  reviewerLabel: string;
  summary: string;
  selfTestSummary: string;
  selfTestHref?: string;
  items: AcceptanceItem[];
  notePlaceholder?: string;
  className?: string;
}

export function acceptanceConclusion(items: AcceptanceItem[]): "pass" | "fail" | "pending" {
  if (items.length === 0 || items.some((item) => item.decision === "pending")) {
    return "pending";
  }

  return items.every((item) => item.decision === "pass") ? "pass" : "fail";
}

export function formatAcceptanceProtocol(
  items: AcceptanceItem[],
  note?: string,
  t: Translate = (key, values) => translate("zh-CN", key, values),
): string {
  const undecided = items.find((item) => item.decision === "pending");
  if (undecided) {
    throw new Error(`Cannot format acceptance protocol with pending item: ${undecided.id}`);
  }

  const lines = items.map((item, index) => {
    const verdict = t(item.decision === "pass" ? "console.accept.pass" : "console.accept.fail");
    const basis = note?.trim() || item.evidence?.trim() || t("console.accept.defaultBasis");
    return t("console.accept.protocolLine", { index: index + 1, verdict, basis });
  });

  lines.push(t("console.accept.conclusion", {
    verdict: t(acceptanceConclusion(items) === "pass" ? "console.accept.pass" : "console.accept.fail"),
  }));
  return lines.join("\n");
}

export function AcceptCard({
  reviewerLabel,
  summary,
  selfTestSummary,
  selfTestHref,
  items,
  notePlaceholder,
  className
}: AcceptCardProps): JSX.Element {
  const { t } = useI18n();
  return (
    <Card className={cn("max-w-[680px] p-4", className)}>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Hand className="h-4 w-4 text-sub" strokeWidth={1.5} aria-hidden="true" />
        <span>{t("console.accept.yourTurn", { reviewer: reviewerLabel })}</span>
      </div>

      <div className="space-y-1 text-sm">
        <p>
          <span className="font-semibold text-ink">{t("console.accept.whatChanged")}</span>
          <span className="text-ink"> · {summary}</span>
        </p>
        <p>
          <span className="font-semibold text-ink">{t("console.accept.selfTested")}</span>
          <span className="text-ink"> · {selfTestSummary}</span>
          {selfTestHref ? (
            <a className="ml-1 inline-flex items-center gap-1 text-accent" href={selfTestHref}>
              {t("console.accept.openRecord")} <ExternalLink className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            </a>
          ) : null}
        </p>
      </div>

      <div className="my-2.5 text-xs font-semibold text-sub">{t("console.accept.reviewEach")}</div>

      <div className="space-y-2.5">
        {items.map((item, index) => (
          <AcceptanceRow key={item.id} item={item} index={index} />
        ))}
      </div>

      <label className="mt-4 block text-xs text-sub" htmlFor="acceptance-note">
        {t("console.accept.basisOptional")}
      </label>
      <Input id="acceptance-note" className="mt-1" placeholder={notePlaceholder ?? t("console.accept.notePlaceholder")} />

      <div className="mt-3.5 flex flex-wrap gap-2.5">
        <Button>{t("console.accept.submit")}</Button>
        <Button variant="outline">{t("console.accept.skip")}</Button>
      </div>
    </Card>
  );
}

function AcceptanceRow({ item, index }: { item: AcceptanceItem; index: number }): JSX.Element {
  const { t } = useI18n();
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="w-3 text-sm font-semibold text-sub">{index + 1}</span>
        <span className="min-w-0 flex-1 text-sm text-ink">{item.statement}</span>
        <DecisionSegment decision={item.decision} />
      </div>
      <div className="ml-6 mt-1 flex flex-wrap items-center gap-1.5 text-xs text-sub">
        {item.artifactLabel ? (
          <>
            <a className="text-accent" href="#">
              {t("console.accept.open")}
            </a>
            <span>{t("console.accept.artifact", { label: item.artifactLabel })}</span>
            <span>·</span>
          </>
        ) : null}
        {item.evidence ? <span>{item.evidence}</span> : <span className="text-hint">{t("console.accept.noEvidence")}</span>}
      </div>
    </div>
  );
}

function DecisionSegment({ decision }: { decision: AcceptanceDecision }): JSX.Element {
  const { t } = useI18n();
  return (
    <span className="flex shrink-0 items-center gap-2" aria-label={t("console.accept.decision")}>
      <Badge variant={decision === "pass" ? "pass" : "interrupted"}>{t("console.accept.pass")}</Badge>
      <Badge variant={decision === "fail" ? "failed" : "interrupted"}>{t("console.accept.fail")}</Badge>
    </span>
  );
}
