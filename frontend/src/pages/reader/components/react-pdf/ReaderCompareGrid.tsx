import { PdfDocumentPane } from "../../pdf/PdfDocumentPane.js";
import type { ProtectedPdfFile } from "../../pdf/useProtectedPdfFile.js";
import type { PageRowHeights } from "../../pdf/usePageRowSync.js";
import {
  READER_SCROLL_SHELL_CLASS,
  READER_SCROLL_SHELL_ID,
} from "../../pdf/reader-dom-contract.js";

export type ReaderCompareGridProps = {
  mode: string; // ReaderMode
  bindShell: (node: HTMLDivElement | null) => void;
  shellEl: HTMLElement | null;
  userZoom: number;
  compareMode: boolean;
  /** 阅读区全宽（shell），用于 zoom% 相对整屏计算 */
  shellWidth: number;
  /** @deprecated 保留兼容，页宽不再用半栏 */
  compareColWidth?: number;
  rowHeights?: PageRowHeights;
  mountSource: boolean;
  mountTranslated: boolean;
  showSource: boolean;
  showTranslated: boolean;
  sourceOnly: boolean;
  sourceUrl: string;
  translatedUrl: string;
  sourceFile: ProtectedPdfFile | null;
  translatedFile: ProtectedPdfFile | null;
  onMetrics: () => void;
  onNumPagesChange: (pages: number, pane: "source" | "translated") => void;
};

export function ReaderCompareGrid(props: ReaderCompareGridProps) {
  const {
    mode,
    bindShell,
    shellEl,
    userZoom,
    compareMode,
    shellWidth,
    rowHeights,
    mountSource,
    mountTranslated,
    showSource,
    showTranslated,
    sourceOnly,
    sourceUrl,
    translatedUrl,
    sourceFile,
    translatedFile,
    onMetrics,
    onNumPagesChange,
  } = props;

  return (
    <div
      ref={bindShell}
      id={READER_SCROLL_SHELL_ID}
      className={READER_SCROLL_SHELL_CLASS}
      data-reader-scroll-shell="true"
    >
      <main
        className={`reader-react-grid reader-mode-${mode}`}
        data-reader-mode={mode}
      >
        {mountSource ? (
          <PdfDocumentPane
            pane="source"
            url={sourceUrl}
            preloadedFile={sourceFile}
            userZoom={userZoom}
            visible={showSource}
            scrollRoot={shellEl}
            pageWidthOverride={shellWidth}
            rowHeights={compareMode ? rowHeights : undefined}
            onMetrics={onMetrics}
            emptyLabel={
              sourceOnly
                ? "源文件不可用：该文档没有可读取的源 PDF。"
                : "暂无原文 PDF"
            }
            onNumPagesChange={onNumPagesChange}
          />
        ) : null}
        {mountTranslated ? (
          <PdfDocumentPane
            pane="translated"
            url={translatedUrl}
            preloadedFile={translatedFile}
            userZoom={userZoom}
            visible={showTranslated}
            scrollRoot={shellEl}
            pageWidthOverride={shellWidth}
            rowHeights={compareMode ? rowHeights : undefined}
            onMetrics={onMetrics}
            emptyLabel="暂无译文 PDF"
            onNumPagesChange={onNumPagesChange}
          />
        ) : null}
      </main>
    </div>
  );
}
