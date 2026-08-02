import { decideFlag } from "./decision.js";

export function executeFixture(values: boolean[]): number {
  let count = 0;
  if (decideFlag(values[0])) count++;
  if (decideFlag(values[1])) count++;
  if (decideFlag(values[2])) count++;
  if (decideFlag(values[3])) count++;
  if (decideFlag(values[4])) count++;
  if (decideFlag(values[5])) count++;
  if (decideFlag(values[6])) count++;
  if (decideFlag(values[7])) count++;
  if (decideFlag(values[8])) count++;
  if (decideFlag(values[9])) count++;
  if (decideFlag(values[10])) count++;
  if (decideFlag(values[11])) count++;
  return count;
}
