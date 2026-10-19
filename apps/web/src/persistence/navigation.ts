export interface NavigableNotes { flush(): Promise<void>; dirty(): boolean; freeze(value: boolean): void }
export async function leaveAfterSave(notes: NavigableNotes | undefined, proceed: () => void | Promise<void>) {
  notes?.freeze(true);
  try {
    await notes?.flush();
    if (notes?.dirty()) throw new Error('Newer edits remain unsaved. Stay here and retry.');
    await proceed();
  } catch (error) { notes?.freeze(false); throw error; }
}
