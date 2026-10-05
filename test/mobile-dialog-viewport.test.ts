import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const navigation = readFileSync(new URL('../web/navigation.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');

test('mobile AWH sheets follow the visual viewport so iOS keyboards cannot cover settings fields', () => {
  assert.match(styles, /height:\s*var\(--awh-visual-viewport-height,\s*100dvh\)/);
  assert.match(styles, /--awh-visual-viewport-top/);
  assert.match(styles, /max-height:\s*calc\(var\(--awh-visual-viewport-height,\s*100dvh\)/);
  assert.match(styles, /scroll-padding-block:/);
});

test('focused controls inside mobile dialogs are revealed after the keyboard viewport changes', () => {
  assert.match(navigation, /function revealFocusedDialogControl/);
  assert.match(navigation, /scrollIntoView\?\.\(\{ block: 'center'/);
  assert.match(navigation, /document\.addEventListener\('focusin', revealFocusedDialogControl/);
  assert.match(navigation, /max-width: 680px/);
});
