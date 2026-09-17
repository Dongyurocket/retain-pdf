export function friendlyLibraryDeleteError(error: unknown): string {
  const details = error && typeof error === "object"
    ? error as { message?: string; status?: number }
    : null;
  const message = `${details?.message || error || ""}`;
  if (details?.status === 409 || message.includes("(409)")) {
    if (/favorite|收藏/i.test(message)) {
      const count = message.match(/(?:referenced by\s+)(\d+)\s+favorite/i)?.[1]
        || message.match(/(\d+)\s*条收藏/)?.[1];
      return count
        ? `该文档有 ${count} 条收藏，请先删除收藏后再删除文档。`
        : "该文档存在收藏引用，请先删除相关收藏后再删除文档。";
    }
    if (/\b(?:running|queued)\b|运行中|排队/i.test(message)) {
      return "该文档仍有运行中或排队中的任务，请先取消任务，等待结束后再删除。";
    }
  }
  return message || "删除文档失败";
}
