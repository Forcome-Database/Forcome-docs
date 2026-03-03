import { useAtom } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import { aiCreatorFilesAtom } from "./ai-creator-atoms";
import classes from "./ai-creator.module.css";

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function AiCreatorFileList() {
  const [files, setFiles] = useAtom(aiCreatorFilesAtom);

  // Create object URLs synchronously (so they're available on first render)
  const imageUrls = useMemo(() => {
    const map = new Map<number, string>();
    files.forEach((file, index) => {
      if (isImageFile(file)) {
        map.set(index, URL.createObjectURL(file));
      }
    });
    return map;
  }, [files]);

  // Revoke old URLs on cleanup
  const prevUrlsRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    // Revoke previous URLs that are no longer in use
    prevUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    prevUrlsRef.current = imageUrls;
    return () => {
      prevUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageUrls]);

  if (files.length === 0) return null;

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className={classes.fileChips}>
      {files.map((file, index) => {
        const thumbUrl = imageUrls.get(index);
        if (thumbUrl) {
          return (
            <span className={classes.fileThumb} key={`${file.name}-${index}`}>
              <img src={thumbUrl} alt={file.name} className={classes.fileThumbImg} />
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
