import {
  discardOwnRecords,
  replaceTextNodes,
  restyle,
  reverseVocabify,
  type SenseRequest,
  setSenseResolver,
  setVocab,
  startObserving,
  stopObserving,
} from './vocabify';
import { setLanguageDetector } from './language';
import {
  domainSettingsStorage,
  translationSettingsStorage,
  vocabToReplaceStorage,
  wanikaniSubjectStylePreferenceStorage,
  wordSenseModelStorage,
} from '@extension/storage';

let active = false;

// The browser's built-in language detector (CLD). It needs no download.
setLanguageDetector(text => chrome.i18n.detectLanguage(text));

/** Asks the background script, which runs the word-sense model. */
async function askModel(requests: SenseRequest[]): Promise<(number | null)[]> {
  const response = (await chrome.runtime.sendMessage({ type: 'vocabify/word-sense', requests })) as
    | { ok: true; choices: (number | null)[] }
    | { ok: false; error: string }
    | undefined;
  if (!response?.ok) throw new Error(response?.error ?? 'No answer from the word-sense model');
  return response.choices;
}

async function loadWordSenseSetting() {
  setSenseResolver((await wordSenseModelStorage.get()) ? askModel : null);
}

async function shouldTranslate(): Promise<boolean> {
  const currentDomain = window.location.hostname;
  const domainSettings = await domainSettingsStorage.get();
  const translationActive = await translationSettingsStorage.getTranslationActive();
  return (
    domainSettings.alwaysTranslateDomain.includes(currentDomain) ||
    (translationActive && !domainSettings.neverTranslateDomain.includes(currentDomain))
  );
}

async function loadVocab() {
  const [vocab, styled] = await Promise.all([vocabToReplaceStorage.get(), wanikaniSubjectStylePreferenceStorage.get()]);
  setVocab(vocab.lookup, styled);
}

async function activate(refreshExisting: boolean) {
  active = true;
  startObserving(document.body);
  await replaceTextNodes(document.body, refreshExisting);
  discardOwnRecords();
}

function deactivate() {
  stopObserving();
  reverseVocabify();
  active = false;
}

async function sync(refreshExisting: boolean) {
  if (await shouldTranslate()) await activate(refreshExisting || active);
  else if (active) deactivate();
}

async function init() {
  await Promise.all([loadVocab(), loadWordSenseSetting()]);
  await sync(false);
}

domainSettingsStorage.subscribe(() => sync(false));
translationSettingsStorage.subscribe(() => sync(false));
vocabToReplaceStorage.subscribe(async () => {
  await loadVocab();
  await sync(true);
});
wordSenseModelStorage.subscribe(async () => {
  await loadWordSenseSetting();
  await sync(true);
});
wanikaniSubjectStylePreferenceStorage.subscribe(async () => {
  restyle(await wanikaniSubjectStylePreferenceStorage.get());
  discardOwnRecords();
});

if (document.body) init();
else document.addEventListener('DOMContentLoaded', () => init(), { once: true });
