export class ProcessCursorError extends Error {
  constructor() {
    super("invalid process history cursor");
    this.name = "ProcessCursorError";
  }
}
