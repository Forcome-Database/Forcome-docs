import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { aiCreatorFilesAtom } from "./ai-creator-atoms";
import classes from "./ai-creator.module.css";

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function AiCreatorFileList() {
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);
  const urlsRef = useRef<string[]>([]);

  // Clean up object URLs on unmount or when files change
  useEffect(() => {
    // Revoke old URLs
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    // Create new URLs for image files
    urlsRef.current = files
      .filter(isImageFile)
      .map((file) => URL.createObjectURL(file));

    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  if (files.length === 0) return null;

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Build a map: imageFileIndex -> objectURL index
  let imgIdx = 0;

  return (
    <div className={classes.fileChips}>
      {files.map((file, index) => {
        if (isImageFile(file)) {
          const url = urlsRef.current[imgIdx++];
          return (
            <span className={classes.fileThumb} key={`${file.name}-${index}`}>
              <img src={url} alt={file.name} className={classes.fileThumbImg} />
              <button
                className={classes.fileThumbRemove}
                onClick={() => removeFile(index)}
              >
                &times;
              </button>
            </span>
          );
        }
        return (
          <span className={classes.fileChip} key={`${file.name}-${index}`}>
            {file.name.length > 18 ? file.name.slice(0, 15) + "..." : file.name}
            <button
              className={classes.fileChipRemove}
              onClick={() => removeFile(index)}
            >
              &times;
            </button>
          </span>
        );
      })}
    </div>
  );
}
