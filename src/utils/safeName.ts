// Control, bidirectional-override and zero-width characters can disguise a file name ("evil\u202Etxt.exe").
// They are shown as visible <U+XXXX> markers. React escapes HTML on its own; this protects against spoofing.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export function safeName(name: string): string {
  return name.replace(INVISIBLE, (c) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`);
}

export const hasInvisibleChars = (name: string): boolean => new RegExp(INVISIBLE.source).test(name);
