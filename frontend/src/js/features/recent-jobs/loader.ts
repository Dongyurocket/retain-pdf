import {
  RECENT_JOBS_LOADING_STATES,
} from "./loading-state-contract.js";
import {
  RECENT_JOBS_PAGE_SIZE,
} from "./pagination.js";
import { createLibraryBooksResource } from "./library-books-resource.js";
import {
  commitRecentJobsEmpty,
  commitRecentJobsError,
  commitRecentJobsNoMore,
  commitRecentJobsPage,
  type ActiveRefreshLoopPort,
  type RecentJobActionsPort,
  type RecentJobsCommitViewPort,
  type RecentJobsInvocationSummary,
} from "./commit.js";
import type { HomeStatePort } from "../home/state.js";
import type { LibraryJobItem } from "./runtime-item.js";
import type { RecentJobsRuntimePatches } from "./runtime-patches.js";
import type { RecentJobsStatePort } from "./state.js";

export interface LoadRecentJobsOptions {
  reset?: boolean;
  silent?: boolean;
  query?: string;
  /** 目标页码(从 1 开始)。reset=true 且未指定时默认第 1 页。 */
  page?: number;
  /** reset=true 时保留当前页码(删除/更新后的 soft 对齐用)。 */
  preservePage?: boolean;
}

export interface LibraryBooksPageData {
  collected?: LibraryJobItem[];
  hasMore?: boolean;
  latestInvocationSummary?: RecentJobsInvocationSummary;
  nextOffset?: number;
  total?: number | null;
}

export interface LibraryBooksResourceSnapshot {
  status?: string;
  error?: unknown;
  data?: LibraryBooksPageData | null;
}

export interface LibraryBooksResourcePort {
  load: (
    params?: {
      startOffset?: number;
      pageSize?: number;
      existingJobIds?: Set<string> | string[];
      query?: string;
    },
    options?: { cache?: boolean },
  ) => Promise<LibraryBooksResourceSnapshot>;
  invalidate?: () => void;
}

export interface CreateRecentJobsLoaderOptions {
  fetchJobList?: (
    apiPrefix?: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  fetchLibraryBookList?: (
    apiPrefix?: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  apiPrefix?: string;
  getQuery?: () => string;
  recentJobActions?: RecentJobActionsPort;
  runtimePatches?: RecentJobsRuntimePatches;
  activeRefreshLoop?: (() => ActiveRefreshLoopPort | null | undefined) | null;
  scheduleAutoLoadIfNeeded?: (() => void) | null;
  homeStatePort?: Pick<HomeStatePort, "setRecentJobsLoadingState">;
  recentJobsStatePort?: Pick<
    RecentJobsStatePort,
    | "getSnapshot"
    | "resetPagination"
    | "batch"
    | "setOffset"
    | "setHasMore"
    | "setTotal"
    | "setCurrentPage"
    | "setInvocationSummary"
    | "setItems"
  >;
  storeDrivenRendering?: boolean;
  viewPort?: RecentJobsCommitViewPort;
  libraryBooksResource?: LibraryBooksResourcePort;
}

export interface RecentJobsLoader {
  isLoading: () => boolean;
  load: (options?: LoadRecentJobsOptions) => Promise<void>;
}

export function createRecentJobsLoader({
  fetchJobList,
  fetchLibraryBookList,
  apiPrefix,
  getQuery,
  recentJobActions,
  runtimePatches,
  activeRefreshLoop,
  scheduleAutoLoadIfNeeded,
  homeStatePort,
  recentJobsStatePort,
  storeDrivenRendering = false,
  viewPort,
  libraryBooksResource = createLibraryBooksResource({
    fetchJobList,
    fetchLibraryBookList,
    apiPrefix,
  }) as LibraryBooksResourcePort,
}: CreateRecentJobsLoaderOptions): RecentJobsLoader {
  let loading = false;
  let pendingLoad: LoadRecentJobsOptions | null = null;

  function isLoading() {
    return loading;
  }

  async function loadLibraryBooksPage(params: {
    startOffset?: number;
    pageSize?: number;
    existingJobIds?: Set<string> | string[];
    query?: string;
  }): Promise<{
    collected: LibraryJobItem[];
    hasMore: boolean;
    latestInvocationSummary: RecentJobsInvocationSummary;
    nextOffset: number;
    total: number | null;
  }> {
    const snapshot = await libraryBooksResource.load(params, {
      cache: false,
    });
    if (snapshot.status === "error") {
      throw snapshot.error || new Error("读取最近任务失败");
    }
    return (snapshot.data || {
      collected: [],
      hasMore: false,
      latestInvocationSummary: null,
      nextOffset: params.startOffset || 0,
      total: null,
    }) as {
      collected: LibraryJobItem[];
      hasMore: boolean;
      latestInvocationSummary: RecentJobsInvocationSummary;
      nextOffset: number;
      total: number | null;
    };
  }

  function resolveTargetPage({
    reset,
    page,
    preservePage,
  }: {
    reset?: boolean;
    page?: number;
    preservePage?: boolean;
  }): number {
    if (Number.isFinite(Number(page)) && Number(page) > 0) {
      return Number(page);
    }
    if (reset) {
      if (preservePage) {
        const currentPage = recentJobsStatePort.getSnapshot().currentPage;
        return Math.max(1, Number(currentPage) || 1);
      }
      return 1;
    }
    // 非 reset:沿用旧语义"下一页"(兼容 load-more 兜底路径)
    const snapshot = recentJobsStatePort.getSnapshot();
    const totalPages = Math.max(1, Math.ceil((Number(snapshot.total) || 0) / RECENT_JOBS_PAGE_SIZE));
    return Math.min(totalPages, Math.max(1, (Number(snapshot.currentPage) || 1) + 1));
  }

  async function load({
    reset = false,
    silent = false,
    query = getQuery?.() || "",
    page,
    preservePage = false,
  }: LoadRecentJobsOptions = {}): Promise<void> {
    if (loading) {
      pendingLoad = {
        reset: reset || Boolean(pendingLoad?.reset),
        silent: silent && pendingLoad?.silent !== false,
        query,
        page,
        preservePage: preservePage || Boolean(pendingLoad?.preservePage),
      };
      return;
    }
    if (!viewPort.hasView()) {
      return;
    }
    loading = true;
    const targetPage = resolveTargetPage({ reset, page, preservePage });
    const startOffset = (targetPage - 1) * RECENT_JOBS_PAGE_SIZE;
    if (!silent) {
      homeStatePort.setRecentJobsLoadingState(RECENT_JOBS_LOADING_STATES.LOADING);
    }
    if (reset) {
      recentJobsStatePort.resetPagination();
      if (!silent) {
        viewPort.renderLoading();
      }
    } else {
      viewPort.setLoadMoreLoading();
    }

    try {
      const { items: previousItems } = recentJobsStatePort.getSnapshot();
      // 分页模式下每页自洽:重置时以空集合去重,不再把已加载项当作排除集。
      const existingJobIds = new Set(
        (reset ? [] : previousItems)
          .map((item) => `${item?.job_id || ""}`.trim())
          .filter(Boolean),
      );
      const {
        collected,
        hasMore,
        latestInvocationSummary,
        nextOffset,
        total,
      } = await loadLibraryBooksPage({
        startOffset,
        pageSize: RECENT_JOBS_PAGE_SIZE,
        existingJobIds,
        query,
      });

      // 总数已知:hasMore 以"是否还有下一页"为准(页码计算一致性)
      const totalPages = Number.isFinite(Number(total))
        ? Math.max(1, Math.ceil((Number(total) || 0) / RECENT_JOBS_PAGE_SIZE))
        : null;
      const nextHasMore = totalPages !== null
        ? targetPage < totalPages
        : hasMore;

      if (reset && collected.length === 0) {
        // 当前页已空(如删掉本页最后一项):自动回退上一页;第 1 页则落空态。
        if (targetPage > 1) {
          loading = false;
          await load({ reset: true, silent, query, page: targetPage - 1 });
          return;
        }
        commitRecentJobsEmpty({
          query,
          invocationSummary: latestInvocationSummary,
          homeStatePort,
          recentJobsStatePort,
          storeDrivenRendering,
          viewPort,
        });
        return;
      }
      if (!reset && collected.length === 0) {
        commitRecentJobsNoMore({
          homeStatePort,
          recentJobsStatePort,
          storeDrivenRendering,
          viewPort,
        });
        return;
      }

      commitRecentJobsPage({
        reset,
        collected,
        hasMore: nextHasMore,
        nextOffset,
        total,
        currentPage: targetPage,
        invocationSummary: latestInvocationSummary,
        query,
        recentJobActions,
        runtimePatches,
        activeRefreshLoop,
        scheduleAutoLoadIfNeeded,
        recentJobsStatePort,
        storeDrivenRendering,
        viewPort,
      });
      homeStatePort.setRecentJobsLoadingState(RECENT_JOBS_LOADING_STATES.READY);
    } catch (err) {
      commitRecentJobsError({
        error: err as { message?: string } | Error | null,
        reset,
        homeStatePort,
        recentJobsStatePort,
        storeDrivenRendering,
        viewPort,
      });
    } finally {
      loading = false;
      if (pendingLoad) {
        const nextLoad = pendingLoad;
        pendingLoad = null;
        window.setTimeout(() => {
          void load(nextLoad);
        }, 0);
      }
    }
  }

  return {
    isLoading,
    load,
  };
}
