import { RotateCcw } from "lucide-react";

import { Button } from "@/ui/button";
import { useI18n } from "@/i18n";

export function RelayReplayButton({ onReplay }: { onReplay: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 text-xs"
      onClick={onReplay}
      data-testid="replay-relay"
    >
      <RotateCcw className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
      {t("onboarding.relay.replay")}
    </Button>
  );
}
