import { useAtom } from "jotai";
import { aiCreatorFilesAtom } from "./ai-creator-atoms";
import classes from "./ai-creator.module.css";

export function AiCreatorFileList() {
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);

  if (files.length === 0) return null;

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className={classes.fileChips}>
      {files.map((file, index) => (
        <span className={classes.fileChip} key={`${file.name}-${index}`}>
          {file.name.length > 18 ? file.name.slice(0, 15) + "..." : file.name}
          <button
            className={classes.fileChipRemove}
            onClick={() => removeFile(index)}
          >
            &times;
          </button>
        </span>
      ))}
    </div>
  );
}
