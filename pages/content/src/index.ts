import {
  discardOwnRecords,
  replaceTextNodes,
  restyle,
  reverseVocabify,
  setVocab,
  startObserving,
  stopObserving,
} from './vocabify';
import {
  domainSettingsStorage,
  translationSettingsStorage,
  vocabToReplaceStorage,
  wanikaniSubjectStylePreferenceStorage,
} from '@extension/storage';

let active = false;

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

function activate(refreshExisting: boolean) {
  startObserving(document.body);
  replaceTextNodes(document.body, refreshExisting);
  discardOwnRecords();
  active = true;
}

function deactivate() {
  stopObserving();
  reverseVocabify();
  active = false;
}

async function sync(refreshExisting: boolean) {
  if (await shouldTranslate()) activate(refreshExisting || active);
  else if (active) deactivate();
}

async function init() {
  await loadVocab();
  await sync(false);
}

domainSettingsStorage.subscribe(() => sync(false));
translationSettingsStorage.subscribe(() => sync(false));
vocabToReplaceStorage.subscribe(async () => {
  await loadVocab();
  await sync(true);
});
wanikaniSubjectStylePreferenceStorage.subscribe(async () => {
  restyle(await wanikaniSubjectStylePreferenceStorage.get());
  discardOwnRecords();
});

if (document.body) init();
else document.addEventListener('DOMContentLoaded', () => init(), { once: true });
