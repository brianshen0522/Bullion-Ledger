import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WizardBack, WizardNext, WizardShell, WizardSubmit } from '../src/WizardShell.js';

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
}

function render(props: Partial<Parameters<typeof WizardShell>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(WizardShell, {
      eyebrow: '編輯',
      subject: '某個東西',
      stepLabel: '第二段',
      stepIndex: 1,
      stepCount: 4,
      onCancel: () => {},
      footer: createElement(WizardNext, { onClick: () => {} }),
      children: createElement('p', null, '內容'),
      ...props,
    }),
  );
}

describe('wizard shell', () => {
  it('names the step and reports progress through it', () => {
    const markup = render();
    expect(markup).toContain('第二段');
    expect(markup).toContain('第 2／4 步');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="2"');
    expect(markup).toContain('aria-valuemax="4"');
  });

  it('shows the subject, not the flow name, when there is one', () => {
    expect(render()).toContain('某個東西');
    expect(render({ subject: undefined })).toContain('編輯');
  });

  it('places banner, body and error in reading order', () => {
    const markup = render({
      banner: createElement('p', null, '橫幅'),
      error: createElement('p', null, '錯誤'),
    });
    expect(markup.indexOf('橫幅')).toBeLessThan(markup.indexOf('內容'));
    expect(markup.indexOf('內容')).toBeLessThan(markup.indexOf('錯誤'));
  });

  it('disables every control while a submission is in flight', () => {
    const markup = render({
      busy: true,
      footer: createElement(WizardSubmit, { busy: true, idle: '送出', working: '送出中…' }),
    });
    expect(markup).toContain('<fieldset disabled=""');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('送出中…');
  });

  it('renders a disabled back button without tripping over it', () => {
    const markup = render({
      footer: createElement(WizardBack, { disabled: true, onClick: () => {} }),
    });
    expect(markup).toContain('上一步');
    expect(markup).toContain('disabled=""');
  });
});

describe('step jumper', () => {
  const steps = [
    { id: 'a', label: '第一' },
    { id: 'b', label: '第二' },
    { id: 'c', label: '第三', disabled: true },
  ];

  it('is absent unless the flow opts in', () => {
    expect(render()).not.toContain('跳至步驟');
  });

  it('lists every step, numbered, with the current one selected', () => {
    const markup = render({ steps, currentStepId: 'b', onStepSelect: () => {} });
    expect(markup).toContain('跳至步驟');
    // A closed combobox shows only the current selection.
    expect(markup).toContain('2. 第二');
  });

  it('marks a step the flow has not opened up yet', () => {
    // Reaching step three early would validate against fields the draft has
    // not filled in, so it is listed but not selectable.
    const markup = render({ steps, currentStepId: 'a', onStepSelect: () => {} });
    expect(markup).toContain('1. 第一');
  });
});

describe('keyboard and pointer conventions', () => {
  const source = read('WizardShell.tsx');

  it('leaves the wizard on Escape, as its sibling sheets already did', () => {
    // A full-screen sheet that ignores Escape is a Mac-shaped gap: the
    // disposal and gift sheets both close on it.
    expect(source).toContain("event.key !== 'Escape'");
    expect(source).toContain('onCancel()');
  });

  it('lets an open dropdown consume Escape first', () => {
    // CustomSelect and SearchableSelect preventDefault on Escape while open,
    // so honouring that flag is what stops one key closing both at once.
    expect(source).toContain('event.defaultPrevented');
  });

  it('ignores Escape while a submission is in flight', () => {
    expect(source).toContain("event.key !== 'Escape' || busy || event.defaultPrevented");
  });
});

/**
 * Every multi-step flow shares this chrome. If one grows its own, the app ends
 * up with two answers to "where is the Next button" again.
 */
describe('every wizard uses the shell', () => {
  it.each([
    ['screens/AssetEditWizard.tsx'],
    ['screens/ProductWizard.tsx'],
    ['purchase-wizard/PurchaseWizard.tsx'],
  ])('%s', (file) => {
    const source = read(file);
    expect(source).toContain('<WizardShell');
    expect(source).toContain('WizardBack');
    // No hand-rolled full-screen chrome alongside the shared one.
    expect(source).not.toContain('fixed inset-0 z-50 flex h-dvh');
  });
});
