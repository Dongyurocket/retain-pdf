// 详情进度卡跟哪一个 job。
//
// 断点恢复 / 阶段重试会换成新 job，详情 payload 往往还停在超时失败的旧 job。
// 新任务一旦终态，不能再把进度卡挂回旧失败任务——否则详情显示失败，
// 图书馆按 active_job_id 刷新后却显示完成。

export type ProgressJobMemory = {
  itemJobId: string;
  successorJobId: string;
  cardWasThisItem: boolean;
};

export function emptyProgressJobMemory(): ProgressJobMemory {
  return { itemJobId: "", successorJobId: "", cardWasThisItem: false };
}

export function rememberProgressSuccessor(
  previous: ProgressJobMemory,
  next: { itemJobId?: string; cardJobId?: string } = {},
): ProgressJobMemory {
  const itemJobId = `${next.itemJobId || ""}`.trim();
  const cardJobId = `${next.cardJobId || ""}`.trim();
  if (itemJobId !== previous.itemJobId) {
    return {
      itemJobId,
      successorJobId: "",
      cardWasThisItem: Boolean(cardJobId) && cardJobId === itemJobId,
    };
  }
  const cardWasThisItem = previous.cardWasThisItem || (Boolean(cardJobId) && cardJobId === itemJobId);
  const successorJobId = cardWasThisItem && cardJobId && cardJobId !== itemJobId
    ? cardJobId
    : previous.successorJobId;
  return { itemJobId, successorJobId, cardWasThisItem };
}

/** 返回应 attach 的 job；空字符串表示保持进度卡现状。 */
export function progressAttachTarget(
  itemJobId = "",
  cardJobId = "",
  successorJobId = "",
): string {
  const item = `${itemJobId || ""}`.trim();
  const card = `${cardJobId || ""}`.trim();
  const successor = `${successorJobId || ""}`.trim();
  if (!item) return "";
  if (card === item) return "";
  if (successor && card === successor) return "";
  if (!card) return successor || item;
  if (card !== item && card !== successor) return item;
  return "";
}
