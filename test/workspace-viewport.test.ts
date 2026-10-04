import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const dashboard = readFileSync(new URL('../web/dashboard.js', import.meta.url), 'utf8');
const start = dashboard.indexOf('  let keyboardViewportBaseline =');
const end = dashboard.indexOf('  new MutationObserver(updateMobileNavigation)', start);

function viewportHarness(width: number, height: number) {
  const classes = new Set<string>();
  const properties = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  class Element { matches() { return true; } }
  const document = {
    activeElement: null as Element | null,
    body: { classList: { toggle(name: string, on: boolean) { if (on) classes.add(name); else classes.delete(name); } } },
    documentElement: { style: { setProperty(name: string, value: string) { properties.set(name, value); } } },
    addEventListener(name: string, fn: () => void) { listeners.set(name, fn); },
  };
  const window = {
    innerWidth: width, innerHeight: height, scrollY: 0,
    visualViewport: { height, offsetTop: 0, addEventListener(name: string, fn: () => void) { listeners.set(`visual:${name}`, fn); } },
    addEventListener(name: string, fn: () => void) { listeners.set(`window:${name}`, fn); },
    setTimeout(fn: () => void) { fn(); },
    requestAnimationFrame(fn: () => void) { fn(); return 1; },
    scrollTo(options: { top?: number }) { this.scrollY = options?.top || 0; },
  };
  vm.runInNewContext(dashboard.slice(start, end), { document, window, HTMLElement: Element });
  return {
    classes, properties,
    focus() { document.activeElement = new Element(); listeners.get('focusin')!(); },
    blur() { document.activeElement = null; listeners.get('focusout')!(); },
    resize(value: number, event = 'visual:resize') {
      window.innerHeight = value; window.visualViewport.height = value; listeners.get(event)!();
    },
    pan(value: number) { window.visualViewport.offsetTop = value; listeners.get('visual:scroll')!(); },
    outerScroll(value: number) { window.scrollY = value; listeners.get('visual:scroll')!(); },
    scrollY() { return window.scrollY; },
  };
}

for (const [width, height] of [[390, 844], [430, 932]]) {
  test(`${width}x${height}: focus is not a keyboard; dismissal restores navigation with focus retained`, () => {
    const h = viewportHarness(width, height);
    h.focus();
    assert.equal(h.classes.has('awh-keyboard-open'), false);
    h.resize(height - 320);
    assert.equal(h.classes.has('awh-keyboard-open'), true);
    assert.equal(h.properties.get('--awh-visual-viewport-height'), `${height - 320}px`);
    h.resize(height);
    assert.equal(h.classes.has('awh-keyboard-open'), false);
    h.blur();
    h.resize(height - 30);
    h.focus();
    assert.equal(h.classes.has('awh-keyboard-open'), false, 'browser chrome changes do not imply keyboard');
  });
  test(`${width}x${height}: layout viewport resize updates the same geometry owner`, () => {
    const h = viewportHarness(width, height);
    h.focus(); h.resize(height - 320, 'window:resize');
    assert.equal(h.classes.has('awh-keyboard-open'), true);
    h.resize(height, 'window:resize');
    assert.equal(h.classes.has('awh-keyboard-open'), false);
  });
}

test('390x844: Safari visual viewport pan is projected immediately and outer page stays locked', () => {
  const h = viewportHarness(390, 844);
  h.focus();
  h.pan(96);
  assert.equal(h.properties.get('--awh-visual-viewport-top'), '96px');
  h.outerScroll(180);
  assert.equal(h.scrollY(), 0, 'focused Work keeps outer layout viewport pinned');
  h.resize(534);
  assert.equal(h.classes.has('awh-keyboard-open'), true);
});

test('focus-only CSS cannot hide navigation after software keyboard dismissal', () => {
  const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /:has\(#goal-input:focus\)/);
  assert.match(css, /top:\s*var\(--awh-visual-viewport-top,0px\)/);
  assert.match(css, /position:\s*fixed/);
});
