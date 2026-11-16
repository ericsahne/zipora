// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../../src/components/Brand';
import { FileExplorer } from '../../src/components/FileExplorer';
import { bytesFile } from '../../src/engine';

const enc = new TextEncoder();
const f = (p: string, c = 'content') => bytesFile(p, enc.encode(c));
const FILES = [f('src/index.ts', 'export const a = 1;'), f('src/lib/util.ts', 'util'), f('README.md', '# Title'), f('logo.png', 'PNG')];

describe('FileExplorer', () => {
  it('shows counts, expands and collapses folders, and lists nested files', async () => {
    const user = userEvent.setup();
    render(<FileExplorer files={FILES} />);
    expect(screen.getByText('4 files')).toBeInTheDocument();
    expect(screen.getByText('2 folders')).toBeInTheDocument();
    const tree = screen.getByRole('tree', { name: 'Archive contents' });
    expect(within(tree).queryByText('index.ts')).not.toBeInTheDocument(); // collapsed by default
    const src = within(tree).getByRole('treeitem', { name: /src/ });
    expect(src).toHaveAttribute('aria-expanded', 'false');
    await user.click(src);
    expect(src).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree).getByText('index.ts')).toBeInTheDocument();
    await user.click(within(tree).getByRole('treeitem', { name: /lib/ }));
    expect(within(tree).getByText('util.ts')).toBeInTheDocument();
    await user.click(src); // collapse hides the children again
    expect(within(tree).queryByText('index.ts')).not.toBeInTheDocument();
  });

  it('searches by name or path and reports when nothing matches', async () => {
    const user = userEvent.setup();
    render(<FileExplorer files={FILES} />);
    await user.type(screen.getByRole('searchbox', { name: /search files/i }), 'util');
    const tree = screen.getByRole('tree');
    expect(within(tree).getByText('util.ts')).toBeInTheDocument(); // parents auto-expanded
    expect(within(tree).queryByText('README.md')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No files match your search.')).toBeInTheDocument();
  });

  it('shows details and a real text preview for the selected file', async () => {
    const user = userEvent.setup();
    render(<FileExplorer files={FILES} />);
    expect(screen.getByText(/Select a file or folder/)).toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /README\.md/ }));
    const info = screen.getByRole('complementary', { name: 'Selected item' });
    expect(within(info).getByText('README.md', { selector: 'p' })).toBeInTheDocument();
    expect(within(info).getByText('7 B')).toBeInTheDocument();
    expect(await within(info).findByLabelText('File preview')).toHaveTextContent('# Title');
    await user.click(screen.getByRole('treeitem', { name: /logo\.png/ }));
    expect(await within(info).findByText('No preview for this file type.')).toBeInTheDocument();
  });

  it('never interprets file names or contents as HTML', async () => {
    const user = userEvent.setup();
    const evil = '<img src=x onerror="window.__pwned=1">.txt';
    const { container } = render(<FileExplorer files={[f(evil, '<script>window.__pwned=2</script>'), f('dir/<b>bold</b>.md', '<b>x</b>')]} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(evil)).toBeInTheDocument(); // shown literally, as text
    await user.click(screen.getByRole('treeitem', { name: /onerror/ }));
    expect(await screen.findByLabelText('File preview')).toHaveTextContent('<script>window.__pwned=2</script>');
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('makes disguised names visible and warns about them', () => {
    render(<FileExplorer files={[f('invoice\u202Etxt.exe')]} />);
    expect(screen.getByText('invoice<U+202E>txt.exe')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/invisible or direction-changing/);
  });

  it('pages very large folders instead of rendering everything at once', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 450 }, (_, i) => f(`f${String(i).padStart(3, '0')}.txt`));
    render(<FileExplorer files={many} />);
    const tree = screen.getByRole('tree');
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(200);
    await user.click(screen.getByRole('button', { name: /Show 200 more \(250 hidden\)/ }));
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(400);
  });

  it('lists empty folders as empty and handles an archive with no files', () => {
    render(<FileExplorer files={[f('a.txt')]} emptyDirs={['ghost']} />);
    expect(screen.getByRole('treeitem', { name: /ghost/ })).toHaveTextContent('empty');
    render(<FileExplorer files={[]} />);
    expect(screen.getByText('This archive has no files.')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('only loads images from GitHub\'s avatar host', () => {
    const { container, rerender } = render(<Avatar src="https://avatars.githubusercontent.com/u/1?v=4" login="octo" />);
    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
    for (const bad of ['https://evil.example/a.png', 'javascript:alert(1)', 'http://avatars.githubusercontent.com/x', 'data:image/svg+xml,<svg/>', '']) {
      rerender(<Avatar src={bad} login="octo" />);
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('oc')).toBeInTheDocument();
    }
  });
});
