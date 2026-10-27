import { useStorage, wanikaniSubjectStylePreferenceStorage, wordSenseModelStorage } from '@extension/storage';
import { Switch, Tooltip } from 'antd';

const OtherSettings = () => {
  const wanikaniSubjectStylePreference = useStorage(wanikaniSubjectStylePreferenceStorage);
  const wordSenseModel = useStorage(wordSenseModelStorage);
  return (
    <div className="m-2">
      <h2 className="font-bold">Other Settings</h2>
      <div className="flex items-center space-x-3 ml-2 mt-2">
        <span className="text-sm">Style Translated Text</span>
        <Switch
          checked={wanikaniSubjectStylePreference}
          onChange={() => wanikaniSubjectStylePreferenceStorage.set(x => !x)}
        />
      </div>
      <div className="flex items-center space-x-3 ml-2 mt-2">
        <Tooltip title="When a word has more than one translation (for example 'tip': 先 or ヒント), a small model on your computer selects the one that fits the sentence. It downloads 23 MB once from Hugging Face. If it is not sure, the word stays in English.">
          <span className="text-sm">Check Meaning in Context</span>
        </Tooltip>
        <Switch checked={wordSenseModel} onChange={() => wordSenseModelStorage.set(x => !x)} />
      </div>
    </div>
  );
};

export default OtherSettings;
