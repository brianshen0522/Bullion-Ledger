import type { PurchaseWizardStep } from './types.js';
import { isWizardStep } from './model.js';

export const PURCHASE_WIZARD_STEP_PARAM = 'purchaseStep';

export function readWizardStepFromSearch(
  search: string,
  parameter = PURCHASE_WIZARD_STEP_PARAM,
): PurchaseWizardStep | null {
  const value = new URLSearchParams(search).get(parameter);
  return isWizardStep(value) ? value : null;
}

export function urlForWizardStep(
  href: string,
  step: PurchaseWizardStep,
  parameter = PURCHASE_WIZARD_STEP_PARAM,
): string {
  const url = new URL(href, 'http://localhost');
  url.searchParams.set(parameter, step);
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface WizardHistoryAdapter {
  read(): PurchaseWizardStep | null;
  push(step: PurchaseWizardStep): void;
  replace(step: PurchaseWizardStep): void;
  subscribe(listener: (step: PurchaseWizardStep | null) => void): () => void;
}

export function createBrowserWizardHistory(
  browserWindow: Window = window,
  parameter = PURCHASE_WIZARD_STEP_PARAM,
): WizardHistoryAdapter {
  return {
    read: () => readWizardStepFromSearch(browserWindow.location.search, parameter),
    push: (step) => {
      browserWindow.history.pushState(
        { ...(browserWindow.history.state as object | null), purchaseWizardStep: step },
        '',
        urlForWizardStep(browserWindow.location.href, step, parameter),
      );
    },
    replace: (step) => {
      browserWindow.history.replaceState(
        { ...(browserWindow.history.state as object | null), purchaseWizardStep: step },
        '',
        urlForWizardStep(browserWindow.location.href, step, parameter),
      );
    },
    subscribe: (listener) => {
      const onPopState = () =>
        listener(readWizardStepFromSearch(browserWindow.location.search, parameter));
      browserWindow.addEventListener('popstate', onPopState);
      return () => browserWindow.removeEventListener('popstate', onPopState);
    },
  };
}
