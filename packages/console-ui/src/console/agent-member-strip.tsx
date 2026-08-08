import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export interface AgentMemberStripItem {
  slug: string;
  /** Rendered inside the chip; the strip owns only ordering and the drag affordances. */
  content: ReactNode;
  selected: boolean;
  primary: boolean;
  disabled?: boolean;
}

/**
 * The member row, ordered by direct manipulation: first place *is* the primary Agent, so dragging
 * a member there is the appointment. There is no separate primary-Agent control — a second entry
 * point for the same act only invites the two to disagree.
 *
 * Built on dnd-kit rather than raw HTML5 drag events. The native API gives no keyboard path and
 * no screen-reader story, which for an appointment control is not a nicety; dnd-kit ships both
 * (Space to lift, arrows to move, Space to drop, with live announcements) so this file does not
 * have to hand-roll either.
 */
export function AgentMemberStrip({
  items,
  reorderable,
  onSelect,
  onReorder,
  trailing,
}: {
  items: readonly AgentMemberStripItem[];
  reorderable: boolean;
  onSelect(slug: string): void;
  onReorder(slugs: string[]): void;
  /** Rendered after the chips, inside the same scroller — typically "Add Agent". */
  trailing?: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const sensors = useSensors(
    // A small distance keeps a plain click on a chip a selection, not a one-pixel drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (over === null || active.id === over.id) {
      return;
    }
    const order = items.map((item) => item.slug);
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) {
      return;
    }
    // An unavailable member cannot be appointed, so it cannot take first place.
    if (to === 0 && items[from]?.disabled === true) {
      return;
    }
    order.splice(to, 0, ...order.splice(from, 1));
    onReorder(order);
  };

  const strip = (
    <div
      className="scroll-thin flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-2"
      role="tablist"
      aria-label={t("console.agentTeamDetail.members")}
      data-testid="agent-team-member-selector"
    >
      {items.map((item) => (
        <MemberChip key={item.slug} item={item} reorderable={reorderable} onSelect={onSelect} />
      ))}
      {trailing}
    </div>
  );

  if (!reorderable) {
    return strip;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragEnd={handleDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: t("console.agentTeamDetail.reorderInstructions") },
      }}
    >
      <SortableContext
        items={items.map((item) => item.slug)}
        strategy={horizontalListSortingStrategy}
      >
        {strip}
      </SortableContext>
    </DndContext>
  );
}

function MemberChip({
  item,
  reorderable,
  onSelect,
}: {
  item: AgentMemberStripItem;
  reorderable: boolean;
  onSelect(slug: string): void;
}): JSX.Element {
  const sortable = useSortable({ id: item.slug, disabled: !reorderable });

  return (
    <button
      ref={sortable.setNodeRef}
      type="button"
      role="tab"
      aria-selected={item.selected}
      aria-controls="agent-team-member-editor"
      data-member-slug={item.slug}
      style={{
        // Translate, not Transform: dnd-kit's transform carries scaleX/scaleY so an item can take
        // on the footprint of the one it displaces. Members are named, so their chips are all
        // different widths, and that scale reads as the dragged chip squashing and stretching.
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition ?? undefined,
      }}
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm",
        item.selected
          ? "border-line-strong bg-sel text-ink"
          : "border-line bg-card text-sub hover:bg-hover hover:text-ink",
        // First place is a slot, not merely the head of a queue: the primary Agent is legible
        // from the shape alone, so the meaning of position needs no caption.
        item.primary && "border-accent/70",
            // 不放抓手图标：整个胶囊都可拖，抓手却暗示「只能从这里拖」，语义本身就是错的。
        // 而且它没有不留痕迹的落点——留在流里每个胶囊左边常年空一块，绝对定位又会在
        // 悬浮时突出到胶囊外。可拖这件事由常驻提示、cursor-grab 和主 Agent 槽位共同表达。
        reorderable && "cursor-grab active:cursor-grabbing",
        sortable.isDragging && "z-10 opacity-60",
      )}
      onClick={() => onSelect(item.slug)}
      // dnd-kit 的 attributes 含 role="button"，会盖掉 tablist 语义，所以只取排序相关的几项。
      aria-roledescription={sortable.attributes["aria-roledescription"]}
      aria-describedby={sortable.attributes["aria-describedby"]}
      tabIndex={sortable.attributes.tabIndex}
      {...sortable.listeners}
    >
      {item.content}
    </button>
  );
}
