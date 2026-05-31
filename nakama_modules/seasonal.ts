// =============================================================================
// U10 — Seasonal Reward System Module (TypeScript)
// =============================================================================
// Responsibility: Season pass, Seasonal XP (SXP), tier rewards, weekly challenges.
//   - SXP is separate from global XP — resets each 8-week season
//   - 20-tier reward track (free, no premium split)
//   - 6 varied weekly challenges per week
//   - 7-day off-season gap between seasons for dev testing
// =============================================================================

// ---------------------------------------------------------------------------
// Season Configuration
// ---------------------------------------------------------------------------

const SEASONS: Array<{ season_id: string; start: number; end: number }> = [
  {
    season_id: "season_1",
    start: Date.UTC(2026, 4, 29),  // May 29, 2026 00:00 UTC
    end:   Date.UTC(2026, 6, 24),  // Jul 24, 2026 00:00 UTC (56 days)
  },
  {
    season_id: "season_2",
    start: Date.UTC(2026, 6, 31),  // Jul 31, 2026 (7-day gap)
    end:   Date.UTC(2026, 8, 25),  // Sep 25, 2026
  },
  {
    season_id: "season_3",
    start: Date.UTC(2026, 9, 2),   // Oct 2, 2026 (7-day gap)
    end:   Date.UTC(2026, 10, 27), // Nov 27, 2026
  },
];

const OFF_SEASON_GAP_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Tier Definitions — 20 tiers, all free
// ---------------------------------------------------------------------------

interface TierDef {
  tier: number;
  sxp_required: number;  // Cumulative SXP to reach this tier
  reward_type: "coins" | "token" | "shield" | "cosmetic";
  reward_value: string | number;
  is_milestone: boolean;
}

const SEASON_TIERS: TierDef[] = [
  { tier: 1,  sxp_required: 200,   reward_type: "coins",    reward_value: 100,                          is_milestone: false },
  { tier: 2,  sxp_required: 450,   reward_type: "token",    reward_value: 1,                            is_milestone: false },
  { tier: 3,  sxp_required: 750,   reward_type: "coins",    reward_value: 150,                          is_milestone: false },
  { tier: 4,  sxp_required: 1100,  reward_type: "shield",   reward_value: "bronze",                     is_milestone: false },
  { tier: 5,  sxp_required: 1500,  reward_type: "cosmetic", reward_value: "avatar_ring_season_sparks",  is_milestone: true  },
  { tier: 6,  sxp_required: 1950,  reward_type: "coins",    reward_value: 200,                          is_milestone: false },
  { tier: 7,  sxp_required: 2450,  reward_type: "token",    reward_value: 2,                            is_milestone: false },
  { tier: 8,  sxp_required: 3000,  reward_type: "shield",   reward_value: "silver",                     is_milestone: false },
  { tier: 9,  sxp_required: 3600,  reward_type: "coins",    reward_value: 350,                          is_milestone: false },
  { tier: 10, sxp_required: 4250,  reward_type: "cosmetic", reward_value: "card_back_season_aura",      is_milestone: true  },
  { tier: 11, sxp_required: 4950,  reward_type: "coins",    reward_value: 500,                          is_milestone: false },
  { tier: 12, sxp_required: 5700,  reward_type: "shield",   reward_value: "gold",                       is_milestone: false },
  { tier: 13, sxp_required: 6500,  reward_type: "coins",    reward_value: 600,                          is_milestone: false },
  { tier: 14, sxp_required: 7350,  reward_type: "token",    reward_value: 3,                            is_milestone: false },
  { tier: 15, sxp_required: 8250,  reward_type: "cosmetic", reward_value: "avatar_frame_crown_seasons", is_milestone: true  },
  { tier: 16, sxp_required: 9200,  reward_type: "coins",    reward_value: 750,                          is_milestone: false },
  { tier: 17, sxp_required: 10200, reward_type: "shield",   reward_value: "platinum",                   is_milestone: false },
  { tier: 18, sxp_required: 11250, reward_type: "coins",    reward_value: 1000,                         is_milestone: false },
  { tier: 19, sxp_required: 12350, reward_type: "cosmetic", reward_value: "card_back_season_phoenix",   is_milestone: false },
  { tier: 20, sxp_required: 13500, reward_type: "cosmetic", reward_value: "title_season_master",        is_milestone: true  },
];

// ---------------------------------------------------------------------------
// Weekly Challenge Pool — 6 chosen per week, one per category max
// ---------------------------------------------------------------------------

interface ChallengeDef {
  id: string;
  category: "match_win" | "match_count" | "streak" | "economy" | "engagement" | "social";
  description: string;
  target: number;
  sxp_reward: number;
  // Tracking field name in player_seasonal.weekly_challenges.progress
  progress_key: string;
}

const CHALLENGE_POOL: ChallengeDef[] = [
  // match_win (pick 1)
  { id: "win_3_any",        category: "match_win",   description: "Win 3 matches in any mode",         target: 3,  sxp_reward: 100, progress_key: "wins_this_week" },
  { id: "win_5_any",        category: "match_win",   description: "Win 5 matches in any mode",         target: 5,  sxp_reward: 150, progress_key: "wins_this_week" },
  { id: "win_gold_plus",    category: "match_win",   description: "Win 1 Gold or higher match",        target: 1,  sxp_reward: 120, progress_key: "gold_plus_wins_this_week" },
  // match_count (pick 1)
  { id: "play_5_any",       category: "match_count", description: "Play 5 matches (any result)",       target: 5,  sxp_reward: 90,  progress_key: "matches_this_week" },
  { id: "play_10_any",      category: "match_count", description: "Play 10 matches (any result)",      target: 10, sxp_reward: 140, progress_key: "matches_this_week" },
  { id: "play_sapphire",    category: "match_count", description: "Play a Sapphire match",             target: 1,  sxp_reward: 120, progress_key: "sapphire_matches_this_week" },
  // streak (pick 1)
  { id: "streak_2",         category: "streak",      description: "Win 2 matches in a row",            target: 2,  sxp_reward: 100, progress_key: "best_streak_this_week" },
  { id: "streak_3",         category: "streak",      description: "Win 3 matches in a row",            target: 3,  sxp_reward: 150, progress_key: "best_streak_this_week" },
  // economy (pick 1)
  { id: "spin_3",           category: "economy",     description: "Spin the wheel 3 times",            target: 3,  sxp_reward: 80,  progress_key: "spins_this_week" },
  { id: "earn_1000_coins",  category: "economy",     description: "Earn 1,000 coins from matches",     target: 1000, sxp_reward: 100, progress_key: "match_coins_this_week" },
  // engagement (pick 1)
  { id: "daily_4",          category: "engagement",  description: "Claim daily login 4 days this week",target: 4,  sxp_reward: 75,  progress_key: "daily_claims_this_week" },
  { id: "daily_7",          category: "engagement",  description: "Claim daily login all 7 days",      target: 7,  sxp_reward: 200, progress_key: "daily_claims_this_week" },
  { id: "watch_3_ads",      category: "engagement",  description: "Watch 3 ads",                       target: 3,  sxp_reward: 75,  progress_key: "ads_this_week" },
  // social (pick 1)
  { id: "open_3_days",      category: "social",      description: "Open the app 3 days in a row",      target: 3,  sxp_reward: 80,  progress_key: "login_streak_this_week" },
];

const CHALLENGE_CATEGORIES = ["match_win", "match_count", "streak", "economy", "engagement", "social"] as const;

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

interface SeasonalConfig {
  seasons: Array<{
    season_id: string;
    start: number;
    end: number;
    tiers?: TierDef[];
    challenges?: ChallengeDef[];
  }>;
  tiers?: TierDef[];
  challenges?: ChallengeDef[];
}

function getSeasonalConfig(nk: nkruntime.Nakama): SeasonalConfig {
  const collection = "system_config";
  const key = "seasonal_rewards";
  const systemUserId = "00000000-0000-0000-0000-000000000000";
  
  try {
    const result = nk.storageRead([{ collection, key, userId: systemUserId }]);
    if (result && result.length > 0) {
      return result[0].value as SeasonalConfig;
    }
  } catch (e) {
    // Fall back to defaults
  }
  
  const defaults: SeasonalConfig = {
    seasons: SEASONS,
    tiers: SEASON_TIERS,
    challenges: CHALLENGE_POOL
  };
  
  try {
    nk.storageWrite([{
      collection,
      key,
      userId: systemUserId,
      value: defaults,
      permissionRead: 2, // Public Read
      permissionWrite: 0, // Server Write Only
    }]);
  } catch (e) {
    // Ignore
  }
  
  return defaults;
}

function getActiveSeason(nk: nkruntime.Nakama, now: number): typeof SEASONS[0] | null {
  const config = getSeasonalConfig(nk);
  for (const s of config.seasons) {
    if (now >= s.start && now < s.end) return s;
  }
  return null;
}

function getNextSeason(nk: nkruntime.Nakama, now: number): typeof SEASONS[0] | null {
  const config = getSeasonalConfig(nk);
  for (const s of config.seasons) {
    if (s.start > now) return s;
  }
  return null;
}

function isOffSeason(nk: nkruntime.Nakama, now: number): boolean {
  return getActiveSeason(nk, now) === null;
}

function getSeasonalProgress(nk: nkruntime.Nakama, userId: string, seasonId: string): any {
  const defaults = {
    season_id: seasonId,
    seasonal_xp: 0,
    current_tier: 0,       // 0 = no tier reached yet, 1-20 = highest tier reached
    tiers_claimed: new Array(20).fill(false),
    win_streak: 0,
    best_streak_this_week: 0,
    first_match_today: false,
    last_first_match_date: 0,
    season_master: false,
    weekly_challenges: null, // Will be initialised on first access
  };
  const result = nk.storageRead([{ collection: "player_seasonal", key: seasonId, userId }]);
  if (result && result.length > 0) {
    return { ...defaults, ...result[0].value };
  }
  return defaults;
}

function writeSeasonalProgress(nk: nkruntime.Nakama, userId: string, seasonId: string, progress: any): void {
  nk.storageWrite([{
    collection: "player_seasonal",
    key: seasonId,
    userId,
    value: progress,
    permissionRead: 1,
    permissionWrite: 0, // Server-only write
  }]);
}

// ---------------------------------------------------------------------------
// Weekly Challenge Helpers
// ---------------------------------------------------------------------------

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function pickWeeklyChallenges(nk: nkruntime.Nakama, weekNumber: number, seasonId?: string): ChallengeDef[] {
  const config = getSeasonalConfig(nk);
  const targetId = seasonId || getActiveSeason(nk, Date.now())?.season_id;
  const seasonObj = config.seasons.find(s => s.season_id === targetId);
  const challengesPool = (seasonObj && seasonObj.challenges) ? seasonObj.challenges : (config.challenges || CHALLENGE_POOL);

  const picked: ChallengeDef[] = [];
  for (const cat of CHALLENGE_CATEGORIES) {
    const pool = challengesPool.filter(c => c.category === cat);
    if (pool.length === 0) continue;
    const idx = weekNumber % pool.length;
    picked.push(pool[idx]);
  }
  return picked;
}

function initWeeklyChallenges(nk: nkruntime.Nakama, weekNumber: number, seasonId?: string): any {
  const challenges = pickWeeklyChallenges(nk, weekNumber, seasonId);
  return {
    week_number: weekNumber,
    challenges: challenges.map(c => ({
      id: c.id,
      category: c.category,
      description: c.description,
      target: c.target,
      sxp_reward: c.sxp_reward,
      progress_key: c.progress_key,
      progress: 0,
      claimed: false,
    })),
    // Weekly progress counters (reset each Monday)
    wins_this_week: 0,
    matches_this_week: 0,
    gold_plus_wins_this_week: 0,
    sapphire_matches_this_week: 0,
    best_streak_this_week: 0,
    spins_this_week: 0,
    match_coins_this_week: 0,
    daily_claims_this_week: 0,
    ads_this_week: 0,
    login_streak_this_week: 0,
  };
}

function syncChallengeProgress(weeklyState: any): any {
  if (!weeklyState || !weeklyState.challenges) return weeklyState;
  for (const ch of weeklyState.challenges) {
    if (!ch.claimed) {
      const currentProgress = weeklyState[ch.progress_key] || 0;
      ch.progress = Math.min(currentProgress, ch.target);
    }
  }
  return weeklyState;
}

// ---------------------------------------------------------------------------
// SXP Tier Recalculation
// ---------------------------------------------------------------------------

function recalculateTier(nk: nkruntime.Nakama, sxp: number, seasonId?: string): number {
  let highestTier = 0;
  const config = getSeasonalConfig(nk);
  const targetId = seasonId || getActiveSeason(nk, Date.now())?.season_id;
  const seasonObj = config.seasons.find(s => s.season_id === targetId);
  const tiersList = (seasonObj && seasonObj.tiers) ? seasonObj.tiers : (config.tiers || SEASON_TIERS);

  for (const td of tiersList) {
    if (sxp >= td.sxp_required) {
      highestTier = td.tier;
    } else {
      break;
    }
  }
  return highestTier;
}

// ---------------------------------------------------------------------------
// PUBLIC: grantSeasonalXP
// Called by economy.ts RPCs (end_match, claim_daily_login, spin_wheel, ad_callback)
// ---------------------------------------------------------------------------

function grantSeasonalXP(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, sxpAmount: number, source: string): void {
  const now = Date.now();
  const activeSeason = getActiveSeason(nk, now);
  if (!activeSeason) {
    logger.info(`[Seasonal] SXP grant skipped — off-season. Source: ${source}`);
    return;
  }

  const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);

  // Ensure weekly challenges are initialised / rolled over
  const weekNumber = getISOWeekNumber(new Date(now));
  if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
    progress.weekly_challenges = initWeeklyChallenges(nk, weekNumber, activeSeason.season_id);
  }

  // Grant SXP
  progress.seasonal_xp += sxpAmount;

  // Recalculate highest tier reached
  const newTier = recalculateTier(nk, progress.seasonal_xp, activeSeason.season_id);
  if (newTier > progress.current_tier) {
    progress.current_tier = newTier;
    logger.info(`[Seasonal] Player ${userId} reached Tier ${newTier}! SXP: ${progress.seasonal_xp}`);
  }

  writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
  logger.info(`[Seasonal] Granted ${sxpAmount} SXP to ${userId} from '${source}'. Total SXP: ${progress.seasonal_xp}`);
}

// ---------------------------------------------------------------------------
// RPC: get_seasonal_status
// ---------------------------------------------------------------------------

function getSeasonalStatusRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const now = Date.now();
  const activeSeason = getActiveSeason(nk, now);
  const nextSeason = getNextSeason(nk, now);

  const config = getSeasonalConfig(nk);

  // Available seasons are those that have already started (now >= s.start)
  const availableSeasons = config.seasons.filter(s => now >= s.start).map(s => ({
    season_id: s.season_id,
    start: s.start,
    end: s.end,
    is_active: now >= s.start && now < s.end
  }));

  let requestedSeasonId: string | null = null;
  if (payload) {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && parsed.season_id) {
        requestedSeasonId = parsed.season_id;
      }
    } catch (e) {
      // Ignored, fallback to default
    }
  }

  // Security check: if requesting a specific season, make sure it has already started
  if (requestedSeasonId) {
    const isStarted = availableSeasons.some(s => s.season_id === requestedSeasonId);
    if (!isStarted) {
      return JSON.stringify({ success: false, error: "Season is locked or does not exist." });
    }
  }

  // Determine target season
  let targetSeason: { season_id: string; start: number; end: number; tiers?: TierDef[] } | null = null;
  if (requestedSeasonId) {
    targetSeason = config.seasons.find(s => s.season_id === requestedSeasonId) || null;
  } else {
    // Default to active season, or the latest available season, or null
    if (activeSeason) {
      targetSeason = activeSeason;
    } else if (availableSeasons.length > 0) {
      const latestId = availableSeasons[availableSeasons.length - 1].season_id;
      targetSeason = config.seasons.find(s => s.season_id === latestId) || null;
    }
  }

  let progress: any = null;
  if (targetSeason) {
    progress = getSeasonalProgress(nk, userId, targetSeason.season_id);

    // Sync weekly challenges only for the active season
    if (activeSeason && targetSeason.season_id === activeSeason.season_id) {
      const weekNumber = getISOWeekNumber(new Date(now));
      if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
        progress.weekly_challenges = initWeeklyChallenges(nk, weekNumber, activeSeason.season_id);
        writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
      } else {
        progress.weekly_challenges = syncChallengeProgress(progress.weekly_challenges);
      }
    }
  }

  const targetSeasonTiers = (targetSeason && targetSeason.tiers) ? targetSeason.tiers : (config.tiers || SEASON_TIERS);

  return JSON.stringify({
    success: true,
    season_active: activeSeason !== null,
    active_season_id: activeSeason?.season_id ?? null,
    next_season_id: nextSeason?.season_id ?? null,
    next_season_start: nextSeason?.start ?? null,
    available_seasons: availableSeasons,

    // Selected/Target Season details
    season_id: targetSeason?.season_id ?? null,
    season_start: targetSeason?.start ?? null,
    season_end: targetSeason?.end ?? null,
    seasonal_xp: progress ? progress.seasonal_xp : 0,
    current_tier: progress ? progress.current_tier : 0,
    tiers_claimed: progress ? progress.tiers_claimed : new Array(20).fill(false),
    season_master: progress ? progress.season_master : false,
    weekly_challenges: progress ? progress.weekly_challenges : null,
    season_tiers: targetSeasonTiers,
    time_remaining_ms: targetSeason ? (targetSeason.end - now) : 0,
  });
}

// ---------------------------------------------------------------------------
// RPC: claim_seasonal_tier
// ---------------------------------------------------------------------------

function claimSeasonalTierRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const now = Date.now();
  const activeSeason = getActiveSeason(nk, now);
  if (!activeSeason) {
    return JSON.stringify({ success: false, error: "No active season." });
  }

  const parsed = payload ? JSON.parse(payload) : {};
  const tierNumber: number = parsed.tier;
  if (!tierNumber || tierNumber < 1 || tierNumber > 20) {
    return JSON.stringify({ success: false, error: "Invalid tier number." });
  }

  const config = getSeasonalConfig(nk);
  const activeSeasonObj = config.seasons.find(s => s.season_id === activeSeason.season_id);
  const tiersList = (activeSeasonObj && activeSeasonObj.tiers) ? activeSeasonObj.tiers : (config.tiers || SEASON_TIERS);
  const tierDef = tiersList.find(t => t.tier === tierNumber);
  
  if (!tierDef) {
    return JSON.stringify({ success: false, error: "Tier definition not found." });
  }

  const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);

  // Check player has enough SXP
  if (progress.seasonal_xp < tierDef.sxp_required) {
    return JSON.stringify({ success: false, error: "Insufficient SXP to claim this tier." });
  }

  // Check not already claimed
  if (progress.tiers_claimed[tierNumber - 1] === true) {
    return JSON.stringify({ success: false, error: "Tier already claimed." });
  }

  // Read player state to apply rewards
  const statsResult = nk.storageRead([{ collection: "player_stats", key: "stats", userId }]);
  const stats = (statsResult && statsResult.length > 0) ? statsResult[0].value : { coins: 0, level: 1 };

  const inventoryResult = nk.storageRead([{ collection: "player_inventory", key: "inventory", userId }]);
  const inventory = (inventoryResult && inventoryResult.length > 0) ? inventoryResult[0].value : {
    spin_tokens: 0,
    shields: { starter: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 },
    unlocked_cosmetics: [],
    equipped_cosmetics: {},
  };

  let rewardDescription = "";

  if (tierDef.reward_type === "coins") {
    const amount = tierDef.reward_value as number;
    stats.coins += amount;
    nk.walletUpdate(userId, { coins: amount }, { source: "seasonal_tier_claim", tier: tierNumber });
    rewardDescription = `${amount} Coins`;

  } else if (tierDef.reward_type === "token") {
    const count = tierDef.reward_value as number;
    inventory.spin_tokens = (inventory.spin_tokens || 0) + count;
    rewardDescription = `${count}× Spin Token`;

  } else if (tierDef.reward_type === "shield") {
    const shieldType = tierDef.reward_value as string;
    inventory.shields = inventory.shields || {};
    inventory.shields[shieldType] = Math.min((inventory.shields[shieldType] || 0) + 1, 3);
    rewardDescription = `1× ${shieldType} Shield`;

  } else if (tierDef.reward_type === "cosmetic") {
    const cosmeticId = tierDef.reward_value as string;
    if (!inventory.unlocked_cosmetics) inventory.unlocked_cosmetics = [];
    if (inventory.unlocked_cosmetics.indexOf(cosmeticId) === -1) {
      inventory.unlocked_cosmetics.push(cosmeticId);
    }
    rewardDescription = `Cosmetic: ${cosmeticId}`;
  }

  // Mark tier as claimed
  progress.tiers_claimed[tierNumber - 1] = true;

  // Check Season Master (Tier 20 claimed)
  if (tierNumber === 20) {
    progress.season_master = true;
    // Permanent season master flag in inventory
    if (!inventory.unlocked_cosmetics) inventory.unlocked_cosmetics = [];
    if (inventory.unlocked_cosmetics.indexOf("title_season_master") === -1) {
      inventory.unlocked_cosmetics.push("title_season_master");
    }
    logger.info(`[Seasonal] 🔥 Player ${userId} achieved SEASON MASTER!`);
  }

  // Write all state back
  nk.storageWrite([{
    collection: "player_stats", key: "stats", userId,
    value: stats, permissionRead: 1, permissionWrite: 1,
  }]);
  nk.storageWrite([{
    collection: "player_inventory", key: "inventory", userId,
    value: inventory, permissionRead: 1, permissionWrite: 0,
  }]);
  writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);

  logger.info(`[Seasonal] Player ${userId} claimed Tier ${tierNumber}: ${rewardDescription}`);
  return JSON.stringify({
    success: true,
    tier_claimed: tierNumber,
    reward_type: tierDef.reward_type,
    reward_value: tierDef.reward_value,
    reward_description: rewardDescription,
    is_milestone: tierDef.is_milestone,
    season_master: progress.season_master,
    new_coins: stats.coins,
    spin_tokens: inventory.spin_tokens,
  });
}

// ---------------------------------------------------------------------------
// RPC: get_weekly_challenges
// ---------------------------------------------------------------------------

function getWeeklyChallengesRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const now = Date.now();
  const activeSeason = getActiveSeason(nk, now);
  if (!activeSeason) {
    return JSON.stringify({ success: false, error: "No active season." });
  }

  const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
  const weekNumber = getISOWeekNumber(new Date(now));

  if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
    progress.weekly_challenges = initWeeklyChallenges(nk, weekNumber, activeSeason.season_id);
    writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
  } else {
    progress.weekly_challenges = syncChallengeProgress(progress.weekly_challenges);
  }

  return JSON.stringify({
    success: true,
    week_number: weekNumber,
    challenges: progress.weekly_challenges.challenges,
  });
}

// ---------------------------------------------------------------------------
// RPC: claim_weekly_challenge
// ---------------------------------------------------------------------------

function claimWeeklyChallengeRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const now = Date.now();
  const activeSeason = getActiveSeason(nk, now);
  if (!activeSeason) {
    return JSON.stringify({ success: false, error: "No active season." });
  }

  const parsed = payload ? JSON.parse(payload) : {};
  const challengeId: string = parsed.challenge_id;
  if (!challengeId) {
    return JSON.stringify({ success: false, error: "Missing challenge_id." });
  }

  const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
  const weekNumber = getISOWeekNumber(new Date(now));

  if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
    return JSON.stringify({ success: false, error: "No active challenges this week." });
  }

  progress.weekly_challenges = syncChallengeProgress(progress.weekly_challenges);
  const challenge = progress.weekly_challenges.challenges.find((c: any) => c.id === challengeId);

  if (!challenge) {
    return JSON.stringify({ success: false, error: "Challenge not found." });
  }
  if (challenge.claimed) {
    return JSON.stringify({ success: false, error: "Challenge already claimed." });
  }
  if (challenge.progress < challenge.target) {
    return JSON.stringify({ success: false, error: "Challenge not yet completed." });
  }

  // Grant SXP reward
  progress.seasonal_xp += challenge.sxp_reward;
  const newTier = recalculateTier(nk, progress.seasonal_xp, activeSeason.season_id);
  if (newTier > progress.current_tier) {
    progress.current_tier = newTier;
  }

  challenge.claimed = true;
  writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);

  logger.info(`[Seasonal] Player ${userId} claimed weekly challenge '${challengeId}': +${challenge.sxp_reward} SXP`);
  return JSON.stringify({
    success: true,
    challenge_id: challengeId,
    sxp_awarded: challenge.sxp_reward,
    total_sxp: progress.seasonal_xp,
    current_tier: progress.current_tier,
  });
}

// ---------------------------------------------------------------------------
// PUBLIC: updateWeeklyProgress
// Called from economy.ts to increment challenge progress counters
// ---------------------------------------------------------------------------

function updateWeeklyProgress(
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  updates: { [key: string]: number }
): void {
  const now = Date.now();
  const activeSeason = getActiveSeason(nk, now);
  if (!activeSeason) return;

  const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
  const weekNumber = getISOWeekNumber(new Date(now));

  if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
    progress.weekly_challenges = initWeeklyChallenges(nk, weekNumber, activeSeason.season_id);
  }

  // Apply increments
  for (const [key, delta] of Object.entries(updates)) {
    if (key === "best_streak_this_week") {
      // Streak is a max, not a sum
      progress.weekly_challenges[key] = Math.max(progress.weekly_challenges[key] || 0, delta);
    } else {
      progress.weekly_challenges[key] = (progress.weekly_challenges[key] || 0) + delta;
    }
  }

  writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
}

// ---------------------------------------------------------------------------
// RPC: update_seasonal_config (Admin / Developer Config Utility)
// ---------------------------------------------------------------------------

function updateSeasonalConfigRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  try {
    const parsed = payload ? JSON.parse(payload) : null;
    if (!parsed || !parsed.seasons) {
      return JSON.stringify({ success: false, error: "Invalid payload: missing seasons." });
    }

    // Identify deleted seasons to clean up related progress entries
    const oldConfig = getSeasonalConfig(nk);
    if (oldConfig && oldConfig.seasons) {
      const newSeasonIds = new Set(parsed.seasons.map((s: any) => s.season_id));
      const deletedSeasonIds = oldConfig.seasons
        .map(s => s.season_id)
        .filter(id => !newSeasonIds.has(id));

      for (const id of deletedSeasonIds) {
        logger.info(`[Seasonal] Season '${id}' was deleted from config. Cleaning up player seasonal progress...`);
        try {
          const query = "DELETE FROM storage WHERE collection = 'player_seasonal' AND key = $1";
          (nk as any).sqlExec(query, [id]);
          logger.info(`[Seasonal] Successfully deleted all player_seasonal progress records for key: ${id}`);
        } catch (err) {
          logger.error(`[Seasonal] Failed to clean up database records for deleted season ${id}: ${(err as Error).message}`);
        }
      }
    }

    nk.storageWrite([{
      collection: "system_config",
      key: "seasonal_rewards",
      userId: "00000000-0000-0000-0000-000000000000",
      value: parsed,
      permissionRead: 2, // Public Read
      permissionWrite: 0, // Server Write Only
    }]);

    logger.info("[Seasonal] Dynamic seasonal config updated via admin RPC.");
    return JSON.stringify({ success: true });
  } catch (e) {
    logger.error(`[Seasonal] Failed to update seasonal config: ${(e as Error).message}`);
    return JSON.stringify({ success: false, error: (e as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Module entry point
// ---------------------------------------------------------------------------

function InitModule(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): void {
  initializer.registerRpc("get_seasonal_status",   getSeasonalStatusRpc);
  initializer.registerRpc("claim_seasonal_tier",   claimSeasonalTierRpc);
  initializer.registerRpc("get_weekly_challenges", getWeeklyChallengesRpc);
  initializer.registerRpc("claim_weekly_challenge",claimWeeklyChallengeRpc);
  initializer.registerRpc("update_seasonal_config",updateSeasonalConfigRpc);
  logger.info("[Seasonal] Seasonal module loaded successfully.");
}
