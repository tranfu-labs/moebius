import "@testing-library/jest-dom/vitest";

/*
 * Radix's Select drives its list with Pointer Events and measures the viewport before opening.
 * jsdom implements neither, so without these the list never mounts and every select-backed test
 * fails for an environment reason rather than a product one.
 */
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

if (typeof globalThis.DOMRect === "undefined") {
  // Radix reads the trigger's box to size and place the list.
  globalThis.DOMRect = class DOMRect {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}

    get top(): number { return this.y; }
    get left(): number { return this.x; }
    get right(): number { return this.x + this.width; }
    get bottom(): number { return this.y + this.height; }
    toJSON(): unknown { return { ...this }; }
  } as unknown as typeof globalThis.DOMRect;
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
