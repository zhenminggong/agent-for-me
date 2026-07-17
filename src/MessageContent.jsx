import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 外链一律新窗口打开，并阻断 opener 引用 */
const components = {
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

/**
 * 助手消息正文：按 Markdown 渲染，流式进行中在末尾跟一个光标。
 * @param {{ text: string, streaming?: boolean }} props
 */
export default function MessageContent({ text, streaming }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
      {streaming && <span className="stream-cursor" aria-hidden="true" />}
    </div>
  );
}
