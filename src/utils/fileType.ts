export type FileKind = 'code' | 'data' | 'text' | 'image' | 'archive' | 'audio' | 'video' | 'sheet' | 'other';

const CODE = 'js jsx mjs cjs ts tsx py rb go rs java kt c h cpp hpp cs php sh bash zsh ps1 html htm css scss sass less vue svelte sql lua swift dart'.split(' ');
const DATA = 'json yml yaml toml xml ini env lock'.split(' ');
const TEXT = 'md mdx txt rst csv tsv log gitignore editorconfig license'.split(' ');
const IMAGE = 'png jpg jpeg gif webp svg ico bmp avif'.split(' ');
const ARCHIVE = 'zip gz tgz tar rar 7z bz2'.split(' ');
const AUDIO = 'mp3 wav ogg flac m4a'.split(' ');
const VIDEO = 'mp4 webm mov mkv avi'.split(' ');
const SHEET = 'xls xlsx ods'.split(' ');

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name.toLowerCase().replace(/^\./, '') : name.slice(i + 1).toLowerCase();
}

export function fileKind(name: string): FileKind {
  const e = extensionOf(name);
  if (CODE.includes(e)) return 'code';
  if (DATA.includes(e)) return 'data';
  if (TEXT.includes(e)) return 'text';
  if (IMAGE.includes(e)) return 'image';
  if (ARCHIVE.includes(e)) return 'archive';
  if (AUDIO.includes(e)) return 'audio';
  if (VIDEO.includes(e)) return 'video';
  if (SHEET.includes(e)) return 'sheet';
  return 'other';
}

export const isPreviewable = (name: string): boolean => ['code', 'data', 'text'].includes(fileKind(name)) || /^(readme|license|makefile|dockerfile)$/i.test(name);
