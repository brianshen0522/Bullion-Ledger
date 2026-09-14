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
