import type { ConversationImageDialogItem } from "@/console/conversation-image-dialog";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";
import type { OperatorMessage } from "@/console/operator-console";
import type { Translate } from "@/i18n";

/**
 * Projects the currently visible conversation into the order used by the
 * image viewer. The attachment id is stable for the lifetime of the message,
 * so the viewer can switch images without creating another preview resource.
 */
export function buildConversationImageGallery(
  messages: readonly OperatorMessage[],
  memberIdentities: readonly OperatorMemberIdentity[],
  t: Translate,
): ConversationImageDialogItem[] {
  return messages.flatMap((message) => {
    const sourceLabel = message.speaker === "user"
      ? t("console.imagePreview.sourceYou")
      : message.speaker === "agent"
        ? t("console.imagePreview.sourceMember", {
            name: resolveOperatorMemberName(message.role, memberIdentities, t),
          })
        : null;
    if (sourceLabel === null) return [];

    return (message.attachments ?? []).flatMap((attachment) => {
      if (attachment.kind !== "image" || attachment.previewUrl === undefined) return [];
      return [{
        id: attachment.attachmentId,
        displayName: attachment.displayName,
        mediaType: attachment.mediaType,
        previewUrl: attachment.previewUrl,
        largePreviewUrl: attachment.largePreviewUrl ?? attachment.previewUrl,
        sourceLabel,
      } satisfies ConversationImageDialogItem];
    });
  });
}
