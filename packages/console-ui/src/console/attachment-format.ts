export function formatAttachmentMediaType(mediaType: string): string {
  if (mediaType === "image/x-icon") return "ICO";
  const subtype = mediaType.split("/")[1]?.split(/[;+]/u)[0]?.trim();
  return (subtype || "FILE").toUpperCase();
}
