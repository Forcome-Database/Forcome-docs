import { useEffect, useRef, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import classes from "./agent-panel.module.css";

const previewMarked = new Marked({ breaks: true });

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr", "div", "span", "details", "summary", "input",
  ],
  ALLOWED_ATTR: [
    "href", "src", "alt", "title", "class", "target", "rel",
    "type", "checked", "disabled",
  ],
};

function useThrottledValue(value: string, streaming?: boolean): string {
  const [throttled, setThrottled] = useState(value);
  const lastUpdate = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!streaming) {
      cancelAnimationFrame(rafRef.current);
      setThrottled(value);
      return;
    }
    const now = Date.now();
    if (now - lastUpdate.current > 67) {
      lastUpdate.current = now;
      setThrottled(value);
    } else {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        lastUpdate.current = Date.now();
        setThrottled(value);
      });
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, streaming]);

  return throttled;
}

interface StreamingMarkdownProps {
  content: string;
  streaming?: boolean;
}

export function StreamingMarkdown({ content, streaming }: StreamingMarkdownProps) {
  const displayContent = useThrottledValue(content, streaming);

  const html = (() => {
    if (!displayContent) return "";
    const raw = previewMarked.parse(displayContent) as string;
    return DOMPurify.sanitize(raw, PURIFY_CONFIG);
  })();

  return (
    <div className={classes.markdownPreview}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming && <span className={classes.streamingCursor} />}
    </div>
  );
}
