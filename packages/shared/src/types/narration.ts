/** Server-authorized plan narration; the revision binds every audio request to
 * the exact script a member is viewing. */
export interface PlanNarrationManifest {
  words: string[];
  version: string;
}

export type PlanNarrationPart = "word" | "respond";
