import { Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { useI18n } from "@/i18n";

export interface ConversationSearchResultItem {
  sessionId: string;
  projectId: string;
  projectTitle: string;
  title: string;
  archived: boolean;
}

export interface ConversationSearchProps {
  results: readonly ConversationSearchResultItem[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string | null;
  onSearch(input: { query: string; includeArchived: boolean }): void;
  onOpen(result: ConversationSearchResultItem): void;
  onRestoreAndOpen(result: ConversationSearchResultItem): void;
  onClose(): void;
}

export function ConversationSearch({
  results,
  status,
  error,
  onSearch,
  onOpen,
  onRestoreAndOpen,
  onClose,
}: ConversationSearchProps): JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [submittedCondition, setSubmittedCondition] = useState<string | null>(null);
  const normalizedQuery = query.trim().normalize("NFKC");
  const currentCondition = `${normalizedQuery.toLowerCase()}\u0000${String(includeArchived)}`;
  const isCurrentResult = submittedCondition === currentCondition;
  const currentStatus = isCurrentResult ? status : "idle";
  const submit = () => {
    if (normalizedQuery !== "" && !isComposing && currentStatus !== "loading") {
      setSubmittedCondition(currentCondition);
      onSearch({ query, includeArchived });
    }
  };
  return (
    <section
      className="absolute inset-0 z-50 flex flex-col bg-canvas"
      aria-label={t("console.conversationSearch.label")}
      data-testid="conversation-search"
    >
      <header className="window-drag-region flex h-[var(--window-header-height)] items-center border-b border-line px-4">
        <h1 className="text-sm font-semibold text-ink">{t("console.conversationSearch.title")}</h1>
        <button
          type="button"
          className="window-no-drag ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink"
          aria-label={t("console.conversationSearch.close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <div className="flex gap-2">
          <Input
            autoFocus
            value={query}
            aria-label={t("console.conversationSearch.queryLabel")}
            placeholder={t("console.conversationSearch.queryPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={(event) => {
              event.currentTarget.dataset.composing = "true";
              setIsComposing(true);
            }}
            onCompositionEnd={(event) => {
              delete event.currentTarget.dataset.composing;
              setIsComposing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.currentTarget.dataset.composing !== "true") {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button
            type="button"
            disabled={normalizedQuery === "" || isComposing || currentStatus === "loading"}
            onClick={submit}
          >
            <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t(currentStatus === "error"
              ? "console.conversationSearch.retry"
              : "console.conversationSearch.submit")}
          </Button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-sub">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => {
              const checked = event.target.checked;
              setIncludeArchived(checked);
              if (normalizedQuery !== "") {
                setSubmittedCondition(`${normalizedQuery.toLowerCase()}\u0000${String(checked)}`);
                onSearch({ query, includeArchived: checked });
              }
            }}
          />
          {t("console.conversationSearch.includeArchived")}
        </label>
        <div className="mt-6 min-h-0 flex-1 overflow-auto">
          {normalizedQuery === "" ? (
            <p className="py-10 text-center text-sm text-sub">{t("console.conversationSearch.neutral")}</p>
          ) : currentStatus === "idle" ? (
            <p className="py-10 text-center text-sm text-sub">{t("console.conversationSearch.ready")}</p>
          ) : currentStatus === "loading" ? (
            <p className="py-10 text-center text-sm text-sub" role="status">
              {t("console.conversationSearch.loading")}
            </p>
          ) : currentStatus === "error" ? (
            <p className="py-10 text-center text-sm text-danger" role="alert">
              {error ?? t("console.conversationSearch.failed")}
            </p>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-sub">{t("console.conversationSearch.empty")}</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
              {results.map((result) => (
                <li key={result.sessionId} className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    disabled={result.archived}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                    aria-label={t("console.conversationSearch.resultLabel", {
                      project: result.projectTitle,
                      title: result.title,
                      status: t(result.archived
                        ? "console.conversationSearch.archived"
                        : "console.conversationSearch.active"),
                    })}
                    onClick={() => onOpen(result)}
                  >
                    <span className="block truncate text-sm font-normal text-ink">{result.title}</span>
                    <span className="mt-0.5 block text-xs text-sub">
                      {result.projectTitle}{result.archived
                        ? ` · ${t("console.conversationSearch.archived")}`
                        : ""}
                    </span>
                  </button>
                  {result.archived ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t("console.conversationSearch.restoreLabel", {
                        project: result.projectTitle,
                        title: result.title,
                      })}
                      onClick={() => onRestoreAndOpen(result)}
                    >
                      {t("console.conversationSearch.restore")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
