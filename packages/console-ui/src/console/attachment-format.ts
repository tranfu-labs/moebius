export function formatAttachmentMediaType(mediaType: string): string {
  const subtype = mediaType.split("/")[1]?.split(/[;+]/u)[0]?.trim();
  return (subtype || "FILE").toUpperCase();
}
