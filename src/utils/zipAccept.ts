/**
 * What the file chooser offers. `.zip` plus the two MIME types Android/Chrome report for ZIP files.
 * This is only a hint to the picker: drag-and-drop and "All files" can bypass it, so the name is also checked
 * in code (isZipName) and the archive's real signature is verified by the engine (inspectZip).
 */
export const ZIP_ACCEPT = '.zip,application/zip,application/x-zip-compressed';

export const isZipName = (name: string): boolean => /\.zip$/i.test(name.trim());
