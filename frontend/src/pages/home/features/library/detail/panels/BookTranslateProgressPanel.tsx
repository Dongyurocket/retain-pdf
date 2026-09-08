// 翻译 Tab 进度区：attachJobProgress（library domain）+ StatusCardEmbedded。
//
// 只要有真实 job_id 就挂载 #book-detail-job-status-card；
// 已完成书用 fallbackItem 补全完成态（见 status/merge-snapshot-with-fallback）。

import { useEffect } from "react";
import { useHomeServices } from "../../../../home-services-context.js";
import { useStoreSnapshot } from "../../../../../../shared/react/use-store.js";
import { StatusCard } from "../../../status/StatusCard.jsx";
import { StageFlow } from "../../../status/StageFlow.jsx";
import type { LibraryCardItem } from "../../types.js";
import { isLibraryOnlyItem } from "../../../../composition/external.js";

function resolveJobId(item: LibraryCardItem = {}) {
  const raw = `${item.job_id || item.active_job_id || ""}`.trim();
  if (!raw || raw.startsWith("doc:")) return "";
  return raw;
}

/**
 * 是否应展示任务进度卡。
 * 只要有真实 job_id 就展示——不要用 library_only 挡掉已完成书
 * （个别投影 library_only 可能不准，但 job_id 在）。
 */
function shouldShowJobProgress(item: LibraryCardItem = {}) {
  const jobId = resolveJobId(item);
  if (!jobId) return false;
  // 明确馆藏且 job 是合成 id 已在 resolveJobId 过滤
  // 有真实 job 即展示（succeeded / running / failed / 甚至 status 空）
  return true;
}

export interface BookTranslateProgressPanelProps {
  item?: LibraryCardItem;
  active?: boolean;
  dialogOpen?: boolean;
}

export function BookTranslateProgressPanel({
  item = {},
  active = true,
  dialogOpen = true,
}: BookTranslateProgressPanelProps) {
  const services = useHomeServices();
  const actions = services.library?.actions;
  const statusCardState = useStoreSnapshot(services.statusCard.store);
  const cardJobId = `${statusCardState?.snapshot?.jobId || ""}`.trim();

  const jobId = resolveJobId(item);
  const showProgress = shouldShowJobProgress(item);
  const libraryOnly = isLibraryOnlyItem(item);
  const itemStatus = `${item.status || ""}`.trim().toLowerCase();

  const cardStatus = `${statusCardState?.snapshot?.status || ""}`.trim().toLowerCase();
  const cardPollingActive = cardStatus === "running"
    || cardStatus === "queued"
    || cardStatus === "pending";

  // 静默拉 job：只喂 statusCardStore。
  // 注意：点「重新 xxx」会切到新 job_id；若 statusCard 已在跑新 job，勿用旧 id 覆盖。
  useEffect(() => {
    if (!dialogOpen || !showProgress || !jobId) return undefined;
    if (cardJobId === jobId) return undefined;
    if (cardJobId && cardPollingActive && cardJobId !== jobId) {
      return undefined;
    }
    actions?.attachJobProgress?.(jobId);
    return undefined;
    // 刻意不把 actions 放进 deps（services 引用稳定，避免无意义重跑）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, showProgress, jobId, cardJobId, cardPollingActive]);

  // 进度主场在详情：仅当主状态区当前可见时才关掉（避免 setVisible 每帧通知死循环）
  useEffect(() => {
    if (!dialogOpen || !showProgress) return undefined;
    if (services.statusArea?.isVisible?.()) {
      services.statusArea.setVisible(false);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, showProgress]);

  // 未翻译馆藏：空态
  if (!showProgress) {
    return (
      <div
        id="book-detail-translate-progress"
        className="book-translate-progress space-y-3 rounded-xl border border-border/60 px-4 py-3.5"
        data-state="idle"
        data-library-only={libraryOnly ? "true" : "false"}
        data-item-status={itemStatus || ""}
        data-job-id=""
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          翻译流程
        </p>
        {/* 空态只保留"路线图预览"（测试契约锁定），不再渲染假进度条/0%——
            禁用态的死机器堆在一起是灰上灰观感的主因 */}
        <div className="pointer-events-none">
          <StageFlow
            id="book-detail-stage-flow"
            currentStageKey=""
            selectedStageKey=""
            onSelectStage={() => {}}
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          尚未开始翻译。选择下方整本或页码范围后发起，进度会实时出现在这里。
        </p>
      </div>
    );
  }

  // fallback：优先跟 statusCard 正在播的 job（含重试新 id），避免用旧 item 盖回完成态
  const liveFallback = cardJobId && cardJobId !== jobId
    ? {
        ...item,
        job_id: cardJobId,
        active_job_id: cardJobId,
        library_only: false,
        status: cardStatus || item.status,
      }
    : item;

  // 有 job：始终挂载完整 StatusCard。
  // 父级 Tabs.Content 用 data-[state=inactive]:hidden 藏面板，节点仍在 DOM
  // （开发者工具可搜 #book-detail-job-status-card）。
  return (
    <div
      id="book-detail-translate-progress"
      className="book-translate-progress"
      data-job-id={cardJobId || jobId}
      data-state={itemStatus === "succeeded" && !cardPollingActive ? "succeeded" : "ready"}
      data-item-status={itemStatus || ""}
      data-library-only={libraryOnly ? "true" : "false"}
      data-tab-active={active ? "true" : "false"}
    >
      <div className="book-detail-status-card-host">
        <StatusCard
          visible
          embedded
          idPrefix="book-detail-"
          rootId="book-detail-job-status-card"
          fallbackItem={liveFallback}
          showHiddenContract={false}
          showResultActions
        />
      </div>
    </div>
  );
}
