// 术语表快速导入面板（支持 CSV/TXT 文件直接导入、拖放、在线模板下载与样例预览）。

import { GLOSSARY_DOM_IDS } from "./glossaries-dom-ids.js";

const CSV_TEMPLATE = `source,target,note,level,match_mode,context\nab initio,从头算,固定译法,canonical,exact,量子化学\nHartree-Fock,,保留英文,preserve,case_insensitive,\nKohn-Sham,Kohn-Sham,保留英文,preserve,exact,量子化学\n`;

const TXT_TEMPLATE = `原词\t译文\t备注\tab initio\t从头算\t量子化学\nHartree-Fock\tHartree-Fock\t保留英文\nKohn-Sham\tKohn-Sham\t量子化学\n`;

export function createGlossaryTemplateBlob(filename, text) {
  const isCsv = filename.toLowerCase().endsWith(".csv");
  const blobParts = isCsv ? ["\uFEFF", text] : [text];
  const mimeType = isCsv ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
  return new Blob(blobParts, { type: mimeType });
}

function downloadTextFile(filename, text) {
  const blob = createGlossaryTemplateBlob(filename, text);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function GlossaryImportPanel({ visible, csvText, onCsvTextChange, onApply, onCancel }) {
  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onCsvTextChange(reader.result);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onCsvTextChange(reader.result);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <div id={GLOSSARY_DOM_IDS.importPanel} className={`glossary-import-panel${visible ? "" : " hidden"}`}>
      <div className="glossary-import-head">
        <h3>快速导入术语表</h3>
        <p className="muted">支持 CSV 和 TXT 格式，可直接拖放文件或选择文件快速读取。</p>
      </div>

      <div
        className="glossary-import-dropzone"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="glossary-import-dropzone-icon">📄</div>
        <div className="glossary-import-dropzone-text">
          <p><strong>拖放 CSV / TXT 文件到此处</strong></p>
          <p className="muted">支持 UTF-8 编码、带表头或无表头的表格内容</p>
        </div>
        <input
          id={GLOSSARY_DOM_IDS.importFileInput}
          type="file"
          accept=".csv,.txt"
          onChange={handleFileChange}
          className="hidden"
        />
        <label htmlFor={GLOSSARY_DOM_IDS.importFileInput} className="app-button secondary glossary-import-browse-btn">
          浏览文件...
        </label>
      </div>

      <div className="glossary-import-templates">
        <p className="glossary-import-templates-title">没有模板？下载样例模板参考格式：</p>
        <div className="glossary-import-template-actions">
          <button type="button" className="app-button secondary" onClick={() => downloadTextFile("glossary-template.csv", CSV_TEMPLATE)}>
            下载 CSV 模板
          </button>
          <button type="button" className="app-button secondary" onClick={() => downloadTextFile("glossary-template.txt", TXT_TEMPLATE)}>
            下载 TXT 模板
          </button>
        </div>
      </div>

      <div className="glossary-import-preview">
        <label className="developer-label">
          <span>待解析内容预览 (可手动编辑)</span>
        </label>
        <textarea
          id={GLOSSARY_DOM_IDS.csvText}
          rows={6}
          placeholder="CSV 格式：原词,译文,备注,类型,匹配模式\nTXT 格式：原词\t译文\t备注"
          value={csvText}
          onChange={(event) => onCsvTextChange(event.target.value)}
        />
      </div>

      <div className="glossary-import-actions">
        <button id={GLOSSARY_DOM_IDS.importApplyButton} type="button" className="app-button" onClick={onApply}>解析导入</button>
        <button id={GLOSSARY_DOM_IDS.importCancelButton} type="button" className="app-button secondary" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
