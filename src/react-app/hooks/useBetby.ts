import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  BetbyBootstrap,
  BetbyFullTree,
  BetbyHealth,
  BetbyKind,
  BetbyMeta,
  BetbySportBranch,
  buildBetbyTree,
  getBetbyBootstrap,
  getBetbyHealth,
  getBetbyMeta,
  getBetbyTreeBest,
  BetbyTreeBestResult,
} from "../services/betby.client";

const STALE_DEFAULT = 15_000;
const STALE_META = 5_000;

export function useBetbyHealth(): UseQueryResult<BetbyHealth, Error> {
  return useQuery({
    queryKey: ["betby", "health"],
    queryFn: getBetbyHealth,
    staleTime: STALE_DEFAULT,
    retry: 1,
  });
}

export function useBetbyBootstrap(): UseQueryResult<BetbyBootstrap, Error> {
  return useQuery({
    queryKey: ["betby", "bootstrap"],
    queryFn: getBetbyBootstrap,
    staleTime: 2 * 60_000,
    retry: 1,
  });
}

export function useBetbyMeta(kind: BetbyKind): UseQueryResult<BetbyMeta, Error> {
  return useQuery({
    queryKey: ["betby", "meta", kind],
    queryFn: () => getBetbyMeta(kind),
    staleTime: STALE_META,
    refetchInterval: 15_000,
    retry: 2,
  });
}

export interface UseBetbyTreeResult extends UseQueryResult<BetbyFullTree, Error> {
  branches: BetbySportBranch[];
  totalEvents: number;
  totalTournaments: number;
  totalCategories: number;
  totalSports: number;
  usedTreeId?: string;
  triedFallbacks?: Array<{ id: string; events: number; ok: boolean }>;
  best: BetbyTreeBestResult | null;
}

export function useBetbyTree(kind: BetbyKind, treeId?: string | number): UseBetbyTreeResult {
  const query = useQuery({
    queryKey: ["betby", "treebest", kind, String(treeId ?? "default")],
    queryFn: () => getBetbyTreeBest(kind, { explicitTreeId: treeId }),
    staleTime: STALE_DEFAULT,
    refetchInterval: kind === "live" ? 10_000 : 30_000,
    retry: 2,
  });

  const best: BetbyTreeBestResult | null = query.data || null;
  const tree: BetbyFullTree | undefined = best?.tree;
  const branches = tree ? buildBetbyTree(tree) : [];
  let totalEvents = 0;
  let totalTournaments = 0;
  let totalCategories = 0;
  for (const s of branches) {
    totalEvents += s.eventCount;
    totalTournaments += s.tournamentCount;
    totalCategories += s.categoryCount;
  }

  return {
    ...(query as any as UseQueryResult<BetbyFullTree, Error>),
    data: tree,
    branches,
    totalEvents,
    totalTournaments,
    totalCategories,
    totalSports: branches.length,
    usedTreeId: best?.usedTreeId,
    triedFallbacks: best?.tried,
    best,
  };
}
