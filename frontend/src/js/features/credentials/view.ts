import { $ } from "../../dom/query.js";
import {
  CREDENTIAL_DOM_DATASETS,
  CREDENTIAL_DOM_IDS,
  CREDENTIAL_DOM_SELECTORS,
} from "./credentials-dom-contract.js";
import { credentialDialog } from "./dialog-view.js";
import { APP_EVENTS } from "../../contracts/app-contract.js";
export {
  activateCredentialTabView,
  browserCredentialElements,
  closeCredentialDialog,
  credentialDialog,
  currentCredentialDialogSetupMode,
  openCredentialDialog,
  setCredentialDialogModeView,
  setDialogStatus,
} from "./dialog-view.js";
export {
  setDeepSeekTopUpVisible,
  setDeepSeekValidationMessage,
  setOcrValidationMessage,
} from "./validation-view.js";

const { browser: BROWSER_CREDENTIAL_IDS } = CREDENTIAL_DOM_IDS;

type UploadTileLockedOptions = {
  locked?: boolean;
  enabled?: boolean;
};

type UploadTileTextOptions = {
  label?: string;
  labelTitle?: string;
  help?: string;
  status?: string;
  statusVisible?: boolean | null;
  labelVisible?: boolean;
  helpVisible?: boolean;
};

/** Minimal tile-port surface used by the credentials gate view. */
export type CredentialUploadTilePort = {
  setUploadTileLocked?: (options?: UploadTileLockedOptions) => void;
  setUploadTileReady?: (ready: boolean) => void;
  setUploadTileText?: (options?: UploadTileTextOptions) => void;
};

export type UpdateCredentialGateViewOptions = {
  desktopMode?: boolean;
  show?: boolean;
  uploadEnabled?: boolean;
  uploadReady?: boolean;
  uploadTilePort?: CredentialUploadTilePort;
};

export type OpenCredentialDialogOptions = {
  setupMode?: boolean;
};

export type BindCredentialViewEventsOptions = {
  resetPaddleValidation?: () => void;
  resetOcrValidation?: (providerId?: string) => void;
  resetDeepSeekValidation?: () => void;
  validateOcr?: () => void;
  validateDeepSeek?: () => void;
  save?: () => void;
  open?: (options?: OpenCredentialDialogOptions) => void;
  activateCredentialTab?: (tabName: string) => void;
  changeProvider?: (event: Event) => void;
};

const noopUploadTilePort: CredentialUploadTilePort = Object.freeze({
  setUploadTileLocked: () => {},
  setUploadTileReady: () => {},
  setUploadTileText: () => {},
});

function uploadTilePortFromOptions(options: Pick<UpdateCredentialGateViewOptions, "uploadTilePort"> = {}) {
  return options.uploadTilePort || noopUploadTilePort;
}

export function syncOcrProviderControlsView(providerId?: string | null) {
  const activeProvider = `${providerId || ""}`.trim();
  const dialog = credentialDialog();
  if (!dialog) {
    return;
  }
  const apiSelect = $(BROWSER_CREDENTIAL_IDS.ocrProviderSelect) as HTMLSelectElement | null;
  if (apiSelect) {
    apiSelect.value = activeProvider;
  }
  dialog.querySelectorAll(CREDENTIAL_DOM_SELECTORS.ocrProviderPanel).forEach((panel) => {
    const el = panel as HTMLElement;
    const active = el.dataset[CREDENTIAL_DOM_DATASETS.ocrProviderPanel] === activeProvider;
    el.classList.toggle("is-active", active);
    el.hidden = !active;
  });
}

export function updateCredentialGateView({
  desktopMode,
  show,
  uploadEnabled,
  uploadReady,
  uploadTilePort,
}: UpdateCredentialGateViewOptions = {}) {
  const tilePort = uploadTilePortFromOptions({ uploadTilePort });
  const trigger = $(CREDENTIAL_DOM_IDS.trigger);
  const gate = $(CREDENTIAL_DOM_IDS.gate);
  if (!gate || !$(CREDENTIAL_DOM_IDS.file)) {
    return false;
  }
  if (desktopMode) {
    gate.classList.add("hidden");
    trigger?.classList.remove("is-nudged");
    tilePort.setUploadTileLocked?.({ locked: !uploadEnabled, enabled: uploadEnabled });
    tilePort.setUploadTileReady?.(!!(uploadEnabled && uploadReady));
    return true;
  }
  gate.classList.toggle("hidden", !show);
  trigger?.classList.toggle("is-nudged", !!show);
  tilePort.setUploadTileLocked?.({ locked: show || !uploadEnabled, enabled: !show && uploadEnabled });
  tilePort.setUploadTileText?.({
    labelVisible: !show,
    helpVisible: true,
    statusVisible: show ? false : null,
  });
  tilePort.setUploadTileReady?.(!!(!show && uploadEnabled && uploadReady));
  return true;
}

export function bindCredentialViewEvents({
  resetPaddleValidation,
  resetDeepSeekValidation,
  validateOcr,
  validateDeepSeek,
  save,
  open,
  activateCredentialTab,
  changeProvider,
}: BindCredentialViewEventsOptions = {}) {
  $(BROWSER_CREDENTIAL_IDS.paddleToken)?.addEventListener("input", resetPaddleValidation);
  $(BROWSER_CREDENTIAL_IDS.apiKey)?.addEventListener("input", resetDeepSeekValidation);
  $(BROWSER_CREDENTIAL_IDS.modelBaseUrl)?.addEventListener("input", resetDeepSeekValidation);
  $(BROWSER_CREDENTIAL_IDS.modelName)?.addEventListener("input", resetDeepSeekValidation);
  $(BROWSER_CREDENTIAL_IDS.paddleValidateButton)?.addEventListener("click", validateOcr);
  $(BROWSER_CREDENTIAL_IDS.deepSeekValidateButton)?.addEventListener("click", validateDeepSeek);
  $(BROWSER_CREDENTIAL_IDS.saveButton)?.addEventListener("click", save);
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const trigger = target?.closest?.(CREDENTIAL_DOM_SELECTORS.trigger);
    if (!trigger) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    open?.();
  });
  credentialDialog()?.querySelectorAll(CREDENTIAL_DOM_SELECTORS.toggleSecret).forEach((button) => {
    const btn = button as HTMLElement;
    btn.addEventListener("click", () => {
      const input = $(btn.dataset[CREDENTIAL_DOM_DATASETS.toggleSecret] || "") as HTMLInputElement | null;
      if (!input) {
        return;
      }
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.classList.toggle("is-revealed", !showing);
      btn.setAttribute("aria-pressed", !showing ? "true" : "false");
    });
  });
  document.addEventListener(APP_EVENTS.openBrowserCredentials, (event: Event) => {
    const detail = (event as CustomEvent<OpenCredentialDialogOptions>).detail || {};
    open?.(detail);
  });
  credentialDialog()?.querySelectorAll(CREDENTIAL_DOM_SELECTORS.credentialTab).forEach((tab) => {
    const tabEl = tab as HTMLElement;
    tabEl.addEventListener("click", () => {
      activateCredentialTab?.(tabEl.dataset[CREDENTIAL_DOM_DATASETS.credentialTab] || "api");
    });
  });
  $(BROWSER_CREDENTIAL_IDS.ocrProviderSelect)?.addEventListener("change", changeProvider);
}
