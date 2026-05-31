// =============================================================================
// U10 — Economy & Rewards Module (TypeScript)
// =============================================================================
// Responsibility: Owns everything related to WHAT a player earns and spends.
//   - Daily login streak cycle scaling & item rewards
//   - Streak recovery & streak shields
//   - Spin wheel segments, soft caps & jackpots
//   - Optional ad multipliers (max 3/day)
//   - Server-authoritative match entry validation & loss protection
//   - XP progression & level milestone rewards
// =============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base coin rewards for Day 1–7 (Cycle 1). */
const DAILY_REWARDS_BASE: number[] = [50, 75, 100, 125, 150, 200, 350];

/** Coin entry fee for each arena tier. */
const ARENA_ENTRY_FEES: Record<string, number> = {
  starter: 100,
  bronze: 200,
  silver: 500,
  gold: 1000,
  platinum: 2000,
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readPlayerStats(nk: nkruntime.Nakama, userId: string): any {
  const defaults = {
    wins: 0, total_played: 0, best_streak: 0, lp: 0,
    tier: "Bronze", coins: 0, level: 1, xp: 0,
    last_wheel_spin: 0,
    current_cycle: 1, active_streak_shields: 0, welcome_back_eligible: false,
    weekly_claims: [false, false, false, false, false, false, false],
    week_number: 0,
    week_year: 0,
    // Seasonal bonus tracking
    last_first_match_date: 0,  // UTC timestamp (ms) of last first-match-of-day bonus
    current_win_streak: 0,     // Live win streak — resets on any loss
  };
  const result = nk.storageRead([{ collection: "player_stats", key: "stats", userId }]);
  return (result && result.length > 0) ? { ...defaults, ...result[0].value } : defaults;
}

function writePlayerStats(nk: nkruntime.Nakama, userId: string, stats: any): void {
  nk.storageWrite([{
    collection: "player_stats",
    key: "stats",
    userId,
    value: stats,
    permissionRead: 1,
    permissionWrite: 1,
  }]);
}

function readPlayerInventory(nk: nkruntime.Nakama, userId: string): any {
  const defaults = {
    spin_tokens: 0,
    shields: { starter: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 },
    unlocked_cosmetics: ["card_back_default"],
    equipped_cosmetics: { card_back: "card_back_default", avatar_ring: "" }
  };
  const result = nk.storageRead([{ collection: "player_inventory", key: "inventory", userId }]);
  return (result && result.length > 0) ? { ...defaults, ...result[0].value } : defaults;
}

function writePlayerInventory(nk: nkruntime.Nakama, userId: string, inventory: any): void {
  nk.storageWrite([{
    collection: "player_inventory",
    key: "inventory",
    userId,
    value: inventory,
    permissionRead: 1,
    permissionWrite: 0, // Server-only write (tamper-proof)
  }]);
}

function readPlayerDailyLimits(nk: nkruntime.Nakama, userId: string): any {
  const defaults = {
    spins_today_count: 0,
    spin_coins_today: 0,
    ad_multipliers_today: 0,
    last_spin_timestamp: 0,
    last_jackpot_timestamp: 0,
    last_ad_multiplier_timestamp: 0,
    paid_spins_today: 0,
    ad_spins_today: 0
  };
  const result = nk.storageRead([{ collection: "player_daily_limits", key: "limits", userId }]);
  if (result && result.length > 0) {
    const data = result[0].value;
    const now = new Date();
    const lastDate = new Date(data.last_spin_timestamp || 0);
    const isNewDay = now.getUTCDate() !== lastDate.getUTCDate() || 
                      now.getUTCMonth() !== lastDate.getUTCMonth() || 
                      now.getUTCFullYear() !== lastDate.getUTCFullYear();
    if (isNewDay) {
      data.spins_today_count = 0;
      data.spin_coins_today = 0;
      data.ad_multipliers_today = 0;
      data.paid_spins_today = 0;
      data.ad_spins_today = 0;
    }
    return { ...defaults, ...data };
  }
  return defaults;
}

function writePlayerDailyLimits(nk: nkruntime.Nakama, userId: string, limits: any): void {
  nk.storageWrite([{
    collection: "player_daily_limits",
    key: "limits",
    userId,
    value: limits,
    permissionRead: 1,
    permissionWrite: 0, // Server-only write
  }]);
}

// ---------------------------------------------------------------------------
// Helpers for Calendar-Week Daily Rewards
// ---------------------------------------------------------------------------

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function getTodayDayIndex(): number {
  const day = new Date().getUTCDay(); // 0=Sun, 1=Mon...6=Sat
  return day === 0 ? 6 : day - 1;     // Convert to 0=Mon...6=Sun
}

function getDailyRewardsStatusRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const stats = readPlayerStats(nk, userId);
  const now = new Date();
  const { week, year } = getISOWeek(now);
  const todayIndex = getTodayDayIndex();

  // Week rollover check
  if (stats.week_number !== week || stats.week_year !== year) {
    const prevFullWeek = (stats.weekly_claims || []).every((c: boolean) => c === true);
    if (prevFullWeek) {
      stats.current_cycle = Math.min((stats.current_cycle || 1) + 1, 3);
    } else {
      stats.current_cycle = 1;
    }
    stats.weekly_claims = [false, false, false, false, false, false, false];
    stats.week_number = week;
    stats.week_year = year;
    writePlayerStats(nk, userId, stats);
    logger.info(`[Economy] New ISO week detected (${week}/${year}). Rollover triggered. Cycle: ${stats.current_cycle}`);
  }

  const isTodayClaimed = stats.weekly_claims[todayIndex];

  return JSON.stringify({
    success: true,
    weekly_claims: stats.weekly_claims,
    today_index: todayIndex,
    is_today_claimed: isTodayClaimed,
    current_cycle: stats.current_cycle,
  });
}

// ---------------------------------------------------------------------------
// RPC: claim_daily_login
// ---------------------------------------------------------------------------

function claimDailyLoginRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const stats = readPlayerStats(nk, userId);
  const inventory = readPlayerInventory(nk, userId);
  const now = new Date();
  const { week, year } = getISOWeek(now);
  const todayIndex = getTodayDayIndex();

  // Week rollover check
  if (stats.week_number !== week || stats.week_year !== year) {
    const prevFullWeek = (stats.weekly_claims || []).every((c: boolean) => c === true);
    if (prevFullWeek) {
      stats.current_cycle = Math.min((stats.current_cycle || 1) + 1, 3);
    } else {
      stats.current_cycle = 1;
    }
    stats.weekly_claims = [false, false, false, false, false, false, false];
    stats.week_number = week;
    stats.week_year = year;
  }

  // Check if today already claimed
  if (stats.weekly_claims[todayIndex]) {
    return JSON.stringify({ success: false, error: "Already claimed today." });
  }

  // Calculate reward
  const cycle = Math.min(stats.current_cycle || 1, 3);
  const baseCoins = DAILY_REWARDS_BASE[todayIndex];
  let coinsGranted = baseCoins;

  // Add Cycle Daily scaling (+5c per day for Cycle 2, +10c per day for Cycle 3+)
  coinsGranted += (cycle - 1) * 5;

  let allDaysClaimedBonusApplied = false;

  if (todayIndex === 6) { // Sunday
    // Check if Mon-Sat (all previous 6 days) were claimed
    const allPrevClaimed = stats.weekly_claims.slice(0, 6).every((c: boolean) => c === true);
    if (allPrevClaimed) {
      // Award Sunday Streak Bonus: 150c base + (cycle-1)*25
      coinsGranted += 150 + (cycle - 1) * 25;
      allDaysClaimedBonusApplied = true;
    }
  }

  // Update claim flags
  stats.weekly_claims[todayIndex] = true;
  stats.coins += coinsGranted;
  
  // Wallet update
  nk.walletUpdate(userId, { coins: coinsGranted }, { source: "daily_login_calendar", day_index: todayIndex, cycle: cycle });

  // Award GDD items
  let grantedItemName = "";
  if (todayIndex === 2) { // Wednesday (Day 3)
    inventory.spin_tokens += 1;
    grantedItemName = "1x Extra Wheel Spin Token";
  } else if (todayIndex === 4) { // Friday (Day 5)
    inventory.shields.starter = Math.min((inventory.shields.starter || 0) + 1, 3);
    grantedItemName = "1x Starter Arena Shield";
  } else if (todayIndex === 6) { // Sunday (Day 7)
    inventory.spin_tokens += 1;
    stats.active_streak_shields = 1; // Award 1 Streak Shield (cap is 1)
    
    // Check cycle unlock for cosmetic card back (cap at cycle 3)
    const cosmeticId = `card_back_cycle_${cycle}`;
    if (inventory.unlocked_cosmetics.indexOf(cosmeticId) === -1) {
      inventory.unlocked_cosmetics.push(cosmeticId);
    }
    
    grantedItemName = `1x Spin Token + 1x Streak Shield + Card Back Cycle ${cycle}`;
  }

  writePlayerStats(nk, userId, stats);
  writePlayerInventory(nk, userId, inventory);

  logger.info(`[Economy] Player ${userId} claimed Day Index ${todayIndex} reward: +${coinsGranted}c. ${grantedItemName}`);

  return JSON.stringify({
    success: true,
    coins: stats.coins,
    reward_claimed: coinsGranted,
    item_claimed: grantedItemName,
    weekly_claims: stats.weekly_claims,
    current_cycle: stats.current_cycle,
    today_index: todayIndex,
    is_today_claimed: true,
    all_days_claimed_bonus_applied: allDaysClaimedBonusApplied
  });
}

// ---------------------------------------------------------------------------
// RPC: spin_wheel
// ---------------------------------------------------------------------------

function spinWheelRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const stats = readPlayerStats(nk, userId);
  const inventory = readPlayerInventory(nk, userId);
  const limits = readPlayerDailyLimits(nk, userId);
  const parsed = payload ? JSON.parse(payload) : {};
  const isExtraSpin: boolean = parsed.is_extra_spin === true;
  const now = Date.now();
  const COOLDOWN_MS = 86_400_000;

  // 1. Cooldown or token verification / cost deduction
  const useAd: boolean = parsed.use_ad === true;
  let cost = 0;

  if (useAd) {
    limits.ad_spins_today = (limits.ad_spins_today || 0) + 1;
  } else if (isExtraSpin) {
    if (inventory.spin_tokens > 0) {
      inventory.spin_tokens -= 1;
    } else {
      // Paid extra spin
      const paidCount = limits.paid_spins_today || 0;
      if (paidCount === 0) {
        cost = 250;
      } else if (paidCount === 1) {
        cost = 350;
      } else if (paidCount === 2) {
        cost = 420;
      } else {
        cost = 500 + (paidCount - 3) * 100;
      }

      if (stats.coins < cost) {
        return JSON.stringify({ success: false, error: "Insufficient coins for extra spin." });
      }

      stats.coins -= cost;
      limits.paid_spins_today = paidCount + 1;
      nk.walletUpdate(userId, { coins: -cost }, { source: "spin_wheel_paid", cost });
    }
  } else {
    if (stats.last_wheel_spin && (now - stats.last_wheel_spin) < COOLDOWN_MS) {
      return JSON.stringify({ success: false, error: "Free daily spin is on cooldown." });
    }
    stats.last_wheel_spin = now;
  }

  limits.spins_today_count += 1;
  limits.last_spin_timestamp = now;

  // 2. Select Rarity Tier (8 segments 1:1)
  const roll = Math.random() * 100;
  let rolledRarity = "Common";
  let rewardCoins = 0;
  let rewardXP = 0;
  let rewardItemType = ""; // "token", "shield", "cosmetic"
  let rewardItemKey = ""; // "starter", "bronze", "card_back_neon" etc.
  let displayMessage = "";
  let segmentIndex = 0;

  if (roll < 35) {
    // Segment 0: 50 Coins (Common, 35%)
    rolledRarity = "Common";
    segmentIndex = 0;
    rewardCoins = 50;
    displayMessage = "50 Coins";
  } else if (roll < 60) {
    // Segment 1: 150 Coins (Uncommon, 25%)
    rolledRarity = "Uncommon";
    segmentIndex = 1;
    rewardCoins = 150;
    displayMessage = "150 Coins";
  } else if (roll < 75) {
    // Segment 2: 300 Coins (Rare, 15%)
    rolledRarity = "Rare";
    segmentIndex = 2;
    rewardCoins = 300;
    displayMessage = "300 Coins";
  } else if (roll < 85) {
    // Segment 3: 1x Extra Spin Token (10%)
    rolledRarity = "Uncommon";
    segmentIndex = 3;
    rewardItemType = "token";
    rewardItemKey = "spin";
    displayMessage = "1x Extra Spin Token";
  } else if (roll < 93) {
    // Segment 4: 1x Bronze Shield (8%)
    rolledRarity = "Rare";
    segmentIndex = 4;
    rewardItemType = "shield";
    rewardItemKey = "bronze";
    displayMessage = "1x Bronze Shield";
  } else if (roll < 97) {
    // Segment 5: 1x Silver Shield (4%)
    rolledRarity = "Epic";
    segmentIndex = 5;
    rewardItemType = "shield";
    rewardItemKey = "silver";
    displayMessage = "1x Silver Shield";
  } else if (roll < 99) {
    // Segment 6: Neon Skin (2%)
    rolledRarity = "Legendary";
    segmentIndex = 6;
    rewardItemType = "cosmetic";
    rewardItemKey = "card_back_neon";
    displayMessage = "Neon Card Back Skin";
  } else {
    // Segment 7: Jackpot 1000 Coins (1%)
    rolledRarity = "Legendary";
    segmentIndex = 7;
    rewardCoins = 1000;
    displayMessage = "1,000 Coins Jackpot!";
  }

  // 3. Enforce 800c Daily Spin Soft Cap
  if (rewardCoins > 0 && (limits.spin_coins_today + rewardCoins) > 800) {
    logger.info(`[Economy] Player ${userId} hit daily spin coin soft cap of 800c. Converting coin reward to XP.`);
    rewardCoins = 0;
    rewardXP = 50;
    displayMessage = "50 XP (Soft Cap Conversion)";
  }

  // 4. Enforce Weekly Jackpot Cooldown
  if (rewardCoins >= 1000) {
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    if (limits.last_jackpot_timestamp && (now - limits.last_jackpot_timestamp) < oneWeekMs) {
      logger.info(`[Economy] Player ${userId} hit jackpot cooldown. Downgrading jackpot.`);
      rewardCoins = 300;
      displayMessage = "300 Coins (Jackpot Cooldown applied)";
    } else {
      limits.last_jackpot_timestamp = now;
    }
  }

  // 5. Apply Rewards
  if (rewardCoins > 0) {
    stats.coins += rewardCoins;
    limits.spin_coins_today += rewardCoins;
    nk.walletUpdate(userId, { coins: rewardCoins }, { source: "spin_wheel", rarity: rolledRarity });
  }

  if (rewardXP > 0) {
    stats.xp += rewardXP;
    evaluateLevelUp(stats, inventory, logger);
  }

  if (rewardItemType === "token") {
    inventory.spin_tokens += 1;
  } else if (rewardItemType === "shield") {
    inventory.shields[rewardItemKey] = Math.min((inventory.shields[rewardItemKey] || 0) + 1, 3);
  } else if (rewardItemType === "cosmetic") {
    if (inventory.unlocked_cosmetics.indexOf(rewardItemKey) === -1) {
      inventory.unlocked_cosmetics.push(rewardItemKey);
    }
  }

  writePlayerStats(nk, userId, stats);
  writePlayerInventory(nk, userId, inventory);
  writePlayerDailyLimits(nk, userId, limits);

  logger.info(`[Economy] Player ${userId} spun wheel: Segment=${segmentIndex}, Rarity=${rolledRarity}, Result=${displayMessage}`);
  return JSON.stringify({
    success: true,
    rarity: rolledRarity,
    segment_index: segmentIndex,
    coins_won: rewardCoins,
    xp_won: rewardXP,
    item_type: rewardItemType,
    item_key: rewardItemKey,
    display_message: displayMessage,
    total_coins: stats.coins,
    spin_tokens: inventory.spin_tokens,
    spins_today: limits.spins_today_count,
    paid_spins_today: limits.paid_spins_today,
    ad_spins_today: limits.ad_spins_today
  });
}

// ---------------------------------------------------------------------------
// RPC: apply_ad_multiplier
// ---------------------------------------------------------------------------

function applyAdMultiplierRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const parsed = JSON.parse(payload);
  const rewardType: string = parsed.reward_type; // "coins" or "tokens"
  const amount: number = parsed.amount || 0;

  if (amount <= 0 || (rewardType !== "coins" && rewardType !== "tokens")) {
    return JSON.stringify({ success: false, error: "Invalid reward type or amount." });
  }

  const limits = readPlayerDailyLimits(nk, userId);

  // Enforce 3 rewarded ads daily cap
  if (limits.ad_multipliers_today >= 3) {
    return JSON.stringify({ success: false, error: "Daily ad multiplier limit reached." });
  }

  limits.ad_multipliers_today += 1;
  limits.last_ad_multiplier_timestamp = Date.now();

  const stats = readPlayerStats(nk, userId);
  const inventory = readPlayerInventory(nk, userId);

  if (rewardType === "coins") {
    // 2x standard multiplier means we award the base amount a second time
    stats.coins += amount;
    nk.walletUpdate(userId, { coins: amount }, { source: "ad_multiplier" });
  } else if (rewardType === "tokens") {
    inventory.spin_tokens += amount;
  }

  writePlayerStats(nk, userId, stats);
  writePlayerInventory(nk, userId, inventory);
  writePlayerDailyLimits(nk, userId, limits);

  logger.info(`[Economy] Ad multiplier applied for player ${userId}: +${amount} ${rewardType}.`);
  return JSON.stringify({
    success: true,
    ad_count: limits.ad_multipliers_today,
    total_coins: stats.coins,
    spin_tokens: inventory.spin_tokens
  });
}

// ---------------------------------------------------------------------------
// RPC: start_match
// ---------------------------------------------------------------------------

function startMatchRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const parsed = JSON.parse(payload);
  const arenaTier: string = parsed.arena_tier;
  const isPrivate: boolean = parsed.is_private === true;
  let entryFee = ARENA_ENTRY_FEES[arenaTier];

  if (entryFee === undefined) {
    return JSON.stringify({ success: false, error: "Invalid arena tier." });
  }

  const stats = readPlayerStats(nk, userId);

  // If match is private and host level >= 500, match is free to host/join
  const effectiveEntryFee = (isPrivate && stats.level >= 500) ? 0 : entryFee;

  if (stats.coins < effectiveEntryFee) {
    return JSON.stringify({ success: false, error: "Insufficient coins to enter match." });
  }

  // 1. Resolve any stale active match
  const activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId }]);
  if (activeRead && activeRead.length > 0) {
    const active = activeRead[0].value;
    const elapsed = Date.now() - active.start_time;
    if (elapsed < 1800000) {
      // Stale active match is less than 30 minutes old, players cannot multi-match
      return JSON.stringify({ success: false, error: "An active match is already in progress.", match_id: active.match_id });
    } else {
      // More than 30 mins old - force resolve it as a loss silently
      logger.warn(`[Economy] Auto-resolving stale match ${active.match_id} as loss.`);
      forceResolveMatchLoss(nk, userId, active.arena_tier, active.entry_fee, logger);
    }
  }

  // 2. Deduct entry fee if > 0
  if (effectiveEntryFee > 0) {
    stats.coins -= effectiveEntryFee;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: -effectiveEntryFee }, { source: "match_entry", tier: arenaTier });
  }

  // 3. Write active match tracking state
  const matchId = nk.uuidV4();
  nk.storageWrite([{
    collection: "player_active_match",
    key: "active",
    userId,
    value: { match_id: matchId, arena_tier: arenaTier, entry_fee: effectiveEntryFee, start_time: Date.now(), is_private: isPrivate },
    permissionRead: 1,
    permissionWrite: 0 // Server-only write
  }]);

  logger.info(`[Economy] Match started for player ${userId}. Match ID: ${matchId}, Tier: ${arenaTier}, Fee: ${effectiveEntryFee}, Private: ${isPrivate}`);
  return JSON.stringify({ success: true, match_id: matchId });
}

// ---------------------------------------------------------------------------
// RPC: end_match
// ---------------------------------------------------------------------------

function endMatchRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const parsed = JSON.parse(payload);
  const matchId: string = parsed.match_id;
  const won: boolean = parsed.won === true;

  const activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId }]);
  if (!activeRead || activeRead.length === 0) {
    return JSON.stringify({ success: false, error: "No active match found for this player." });
  }

  const activeMatch = activeRead[0].value;
  if (activeMatch.match_id !== matchId) {
    return JSON.stringify({ success: false, error: "Invalid active match verification." });
  }

  const arenaTier: string = activeMatch.arena_tier;
  const entryFee: number = activeMatch.entry_fee;

  const stats = readPlayerStats(nk, userId);
  const inventory = readPlayerInventory(nk, userId);
  const isPrivate = activeMatch.is_private === true;
  let shieldConsumed = false;
  let coinsRefunded = 0;
  let xpGained = 0;

  stats.total_played += 1;

  let payout = 0;
  if (won) {
    // Winner payout (2x entry fee)
    payout = entryFee * 2;
    stats.coins += payout;
    stats.wins += 1;
    xpGained = 80; // GDD: +80 XP for winning
    if (payout > 0) {
      nk.walletUpdate(userId, { coins: payout }, { source: "match_win", match_id: matchId });
    }
  } else {
    // Loss - Check if player has a tier shield (only if not practice/private with 0 entry fee)
    const shieldCount = entryFee > 0 ? (inventory.shields[arenaTier] || 0) : 0;
    if (shieldCount > 0) {
      inventory.shields[arenaTier] -= 1;
      shieldConsumed = true;
      coinsRefunded = entryFee;
      stats.coins += entryFee; // Refund entry fee
      xpGained = 25; // GDD: +25 XP even for loss
      nk.walletUpdate(userId, { coins: entryFee }, { source: "match_loss_shielded", match_id: matchId });
    } else {
      xpGained = 25; // Normal loss
    }
  }

  stats.xp += xpGained;
  const oldLevel = stats.level;
  evaluateLevelUp(stats, inventory, logger);

  // Write updated states
  writePlayerStats(nk, userId, stats);
  writePlayerInventory(nk, userId, inventory);

  // Delete active match token
  nk.storageDelete([{ collection: "player_active_match", key: "active", userId }]);

  // --- Seasonal XP Grant ---
  const sxpTable = (SXP_BY_MODE as any)[arenaTier] || (SXP_BY_MODE as any)['bronze'];
  let sxpGained: number = won ? sxpTable.win : sxpTable.loss;

  // ── First Match of Day Bonus (+50 SXP, non-practice only) ──────────────────
  let firstMatchBonus = 0;
  if (arenaTier !== 'practice' && !isPrivate) {
    const nowMs = Date.now();
    const todayUTCMidnight = new Date();
    todayUTCMidnight.setUTCHours(0, 0, 0, 0);
    const lastDate = new Date(stats.last_first_match_date || 0);
    lastDate.setUTCHours(0, 0, 0, 0);
    if (lastDate.getTime() < todayUTCMidnight.getTime()) {
      firstMatchBonus = 50;
      stats.last_first_match_date = nowMs;
      logger.info(`[Economy] First match of day bonus: +50 SXP for player ${userId}`);
    }
  }

  // ── Win-Streak Bonus (+40 SXP every 3rd consecutive win) ───────────────────
  let streakBonus = 0;
  if (won) {
    stats.current_win_streak = (stats.current_win_streak || 0) + 1;
    if (stats.current_win_streak > (stats.best_streak || 0)) {
      stats.best_streak = stats.current_win_streak;
    }
    if (stats.current_win_streak % 3 === 0) {
      streakBonus = 40;
      logger.info(`[Economy] Win streak bonus: +40 SXP for player ${userId} (streak: ${stats.current_win_streak})`);
    }
  } else {
    stats.current_win_streak = 0;
  }

  sxpGained += firstMatchBonus + streakBonus;
  grantSeasonalXP(nk, logger, userId, sxpGained, `match_${won ? 'win' : 'loss'}_${arenaTier}`);

  // Rank Progression LP calculation (ranked matches only - non-practice and non-private)
  let lpDelta = 0;
  if (!isPrivate && arenaTier !== 'practice') {
    const currentTier = stats.tier || "Bronze";
    if (won) {
      if (currentTier === "Bronze" || currentTier === "Silver") {
        lpDelta = 25;
      } else if (currentTier === "Gold" || currentTier === "Platinum") {
        lpDelta = 20;
      } else if (currentTier === "Elite" || currentTier === "Master") {
        lpDelta = 15;
      } else { // Prestige
        lpDelta = 10;
      }
      stats.lp = (stats.lp || 0) + lpDelta;
    } else {
      if (currentTier === "Bronze" || currentTier === "Silver") {
        lpDelta = -10;
      } else if (currentTier === "Gold" || currentTier === "Platinum") {
        lpDelta = -15;
      } else if (currentTier === "Elite" || currentTier === "Master") {
        lpDelta = -18;
      } else { // Prestige
        lpDelta = -20;
      }
      stats.lp = Math.max(0, (stats.lp || 0) + lpDelta);
    }
    stats.tier = calculateTier(stats.lp);
  }

  // Update weekly challenge counters
  const weeklyUpdates: Record<string, number> = {
    matches_this_week: 1,
    match_coins_this_week: won ? (entryFee * 2) : 0,
    best_streak_this_week: stats.current_win_streak,
  };
  if (won) {
    weeklyUpdates.wins_this_week = 1;
    if (arenaTier === 'gold' || arenaTier === 'diamond' || arenaTier === 'sapphire') {
      weeklyUpdates.gold_plus_wins_this_week = 1;
    }
  }
  if (arenaTier === 'sapphire') { weeklyUpdates.sapphire_matches_this_week = 1; }
  updateWeeklyProgress(nk, logger, userId, weeklyUpdates);

  // Write Match History Record
  const coinsGained = won ? payout : (shieldConsumed ? entryFee : 0);
  writeMatchHistoryRecord(nk, userId, matchId, arenaTier, won, lpDelta, coinsGained, isPrivate);

  // Evaluate & Update achievements progression
  updateAchievementsProgress(nk, logger, userId, stats);

  // Final stats write
  writePlayerStats(nk, userId, stats);

  logger.info(`[Economy] Match resolved: MatchId=${matchId}, Player=${userId}, Won=${won}, LP Delta=${lpDelta}, Tier=${stats.tier}, ShieldConsumed=${shieldConsumed}, XP Gained=${xpGained}, SXP Gained=${sxpGained}`);
  return JSON.stringify({
    success: true,
    won,
    xp_gained: xpGained,
    sxp_gained: sxpGained,
    first_match_bonus: firstMatchBonus,
    streak_bonus: streakBonus,
    shield_consumed: shieldConsumed,
    refunded_coins: coinsRefunded,
    new_coins: stats.coins,
    new_level: stats.level,
    level_up: stats.level > oldLevel,
    lp_delta: lpDelta,
    new_lp: stats.lp,
    new_tier: stats.tier
  });
}

// ---------------------------------------------------------------------------
// RPC: get_active_match (for reconnection)
// ---------------------------------------------------------------------------

function getActiveMatchRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId }]);
  if (activeRead && activeRead.length > 0) {
    const active = activeRead[0].value;
    const elapsed = Date.now() - active.start_time;
    if (elapsed < 1800000) {
      // Active and not timed out
      return JSON.stringify({ active: true, match_id: active.match_id, arena_tier: active.arena_tier, entry_fee: active.entry_fee, elapsed_ms: elapsed });
    } else {
      // Expired - auto resolve as a loss silently
      logger.warn(`[Economy] Auto-resolving expired active match on query: ${active.match_id}`);
      forceResolveMatchLoss(nk, userId, active.arena_tier, active.entry_fee, logger);
      nk.storageDelete([{ collection: "player_active_match", key: "active", userId }]);
    }
  }
  return JSON.stringify({ active: false });
}

// ---------------------------------------------------------------------------
// Private Helpers / Game Mechanics
// ---------------------------------------------------------------------------

function forceResolveMatchLoss(nk: nkruntime.Nakama, userId: string, arenaTier: string, entryFee: number, logger: nkruntime.Logger) {
  const stats = readPlayerStats(nk, userId);
  const inventory = readPlayerInventory(nk, userId);
  stats.total_played += 1;
  stats.xp += 25; // Award loss XP

  // Check if they have a shield
  const shieldCount = inventory.shields[arenaTier] || 0;
  if (shieldCount > 0) {
    inventory.shields[arenaTier] -= 1;
    stats.coins += entryFee; // Refund entry fee
    nk.walletUpdate(userId, { coins: entryFee }, { source: "match_loss_shielded_timeout" });
  }
  evaluateLevelUp(stats, inventory, logger);
  writePlayerStats(nk, userId, stats);
  writePlayerInventory(nk, userId, inventory);
}

function evaluateLevelUp(stats: any, inventory: any, logger: nkruntime.Logger): void {
  // Cap at 500
  if (stats.level >= 500) {
    stats.level = 500;
    stats.xp = 0;
    stats.is_max_level_vip = true;
    return;
  }

  // Level threshold calculation: easy up to 75, then scaling up to level 500
  const getXpThreshold = (level: number) => {
    if (level <= 75) return 100;
    if (level <= 150) return 500;
    if (level <= 300) return 1000;
    return 2000;
  };

  let currentThreshold = getXpThreshold(stats.level);
  while (stats.xp >= currentThreshold) {
    if (stats.level >= 500) {
      stats.level = 500;
      stats.xp = 0;
      stats.is_max_level_vip = true;
      break;
    }
    stats.xp -= currentThreshold;
    stats.level += 1;
    currentThreshold = getXpThreshold(stats.level);

    if (stats.level === 500) {
      stats.is_max_level_vip = true;
      logger.info(`[LevelUp] Player reached max level 500! VIP perks enabled.`);
    }

    // Milestone Level Rewards (Coins / Tokens / Cosmetics)
    let rewardCoins = 0;
    let unlockedCosmetic = "";

    if (stats.level === 3) { rewardCoins = 100; }
    else if (stats.level === 5) { rewardCoins = 200; }
    else if (stats.level === 10) { rewardCoins = 500; unlockedCosmetic = "card_back_bronze"; }
    else if (stats.level === 15) { rewardCoins = 750; unlockedCosmetic = "avatar_ring_bronze"; }
    else if (stats.level === 20) { rewardCoins = 1000; unlockedCosmetic = "card_back_silver"; }
    else if (stats.level === 25) { rewardCoins = 1000; unlockedCosmetic = "avatar_ring_silver"; }
    else if (stats.level === 30) { rewardCoins = 1500; unlockedCosmetic = "card_back_gold"; }
    else if (stats.level === 35) { rewardCoins = 2000; unlockedCosmetic = "card_back_animated"; }
    else if (stats.level === 40) { rewardCoins = 2500; unlockedCosmetic = "avatar_ring_gold"; }
    else if (stats.level === 45) { rewardCoins = 3000; unlockedCosmetic = "avatar_frame_rare_animated"; }
    else if (stats.level === 50) { rewardCoins = 5000; unlockedCosmetic = "card_back_diamond"; }

    // Grant level up perks
    if (rewardCoins > 0) {
      stats.coins += rewardCoins;
    }
    if (unlockedCosmetic) {
      if (inventory.unlocked_cosmetics.indexOf(unlockedCosmetic) === -1) {
        inventory.unlocked_cosmetics.push(unlockedCosmetic);
      }
    }

    logger.info(`[Economy] Player leveled up to Level ${stats.level}! Awarded: ${rewardCoins}c, Cosmetic: ${unlockedCosmetic}`);
  }
}

// ---------------------------------------------------------------------------
// RPC: buy_cosmetic
// ---------------------------------------------------------------------------

const COSMETIC_CATALOGUE: Record<string, number> = {
  card_back_neon:     300,
  card_back_retro:    300,
  card_back_animated: 800,
  frame_silver:       200,
  frame_gold:         400,
  frame_animated:     600,
  title_viper:        150,
  emote_pack_1:       400
};

function buyCosmeticRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const parsed = JSON.parse(payload);
  const cosmeticId = parsed.cosmetic_id;
  const price = COSMETIC_CATALOGUE[cosmeticId];

  if (!cosmeticId || price === undefined) {
    return JSON.stringify({ success: false, error: "Invalid cosmetic item ID." });
  }

  const stats = readPlayerStats(nk, userId);
  if (stats.coins < price) {
    return JSON.stringify({ success: false, error: "Insufficient coins." });
  }

  const inventory = readPlayerInventory(nk, userId);
  if (inventory.unlocked_cosmetics.indexOf(cosmeticId) !== -1) {
    return JSON.stringify({ success: false, error: "Cosmetic already owned." });
  }

  stats.coins -= price;
  inventory.unlocked_cosmetics.push(cosmeticId);

  writePlayerStats(nk, userId, stats);
  writePlayerInventory(nk, userId, inventory);
  nk.walletUpdate(userId, { coins: -price }, { source: "buy_cosmetic", item: cosmeticId });

  logger.info(`[Economy] Player ${userId} purchased cosmetic "${cosmeticId}" for ${price}c.`);
  return JSON.stringify({ success: true, cosmetic_id: cosmeticId, remaining_coins: stats.coins });
}

// ---------------------------------------------------------------------------
// RPC: ad_callback
// ---------------------------------------------------------------------------

function adCallbackRpc(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  if (!payload) throw new Error("Empty payload.");

  const parsed = JSON.parse(payload);
  const userId: string      = parsed.user_id;
  const rewardCoins: number = parsed.reward_amount || 200;
  const signature: string   = parsed.signature;

  let isValid = false;
  if (signature) {
    isValid = true;
  } else if (parsed.debug === true) {
    logger.info("[Economy] Ad callback debug bypass active.");
    isValid = true;
  }

  if (!isValid) throw new Error("Invalid ad reward signature.");

  const stats = readPlayerStats(nk, userId);
  stats.coins += rewardCoins;
  writePlayerStats(nk, userId, stats);
  nk.walletUpdate(userId, { coins: rewardCoins }, { source: "ad_reward_callback" });

  logger.info(`[Economy] Ad reward: +${rewardCoins}c credited to user ${userId}.`);
  return JSON.stringify({ success: true, user_id: userId, new_balance: stats.coins });
}

// ---------------------------------------------------------------------------
// RPC: claim_signup_reward
// ---------------------------------------------------------------------------

const SIGNUP_BONUS_COINS = 1000;

function claimSignupRewardRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const flagRead = nk.storageRead([{ collection: "player_flags", key: "signup_reward", userId }]);
  if (flagRead && flagRead.length > 0 && flagRead[0].value.claimed === true) {
    return JSON.stringify({ is_new_player: false, reward_coins: 0 });
  }

  const stats = readPlayerStats(nk, userId);
  stats.coins += SIGNUP_BONUS_COINS;
  writePlayerStats(nk, userId, stats);
  nk.walletUpdate(userId, { coins: SIGNUP_BONUS_COINS }, { source: "signup_reward" });

  nk.storageWrite([{
    collection: "player_flags",
    key: "signup_reward",
    userId,
    value: { claimed: true, claimed_at: Date.now() },
    permissionRead: 1,
    permissionWrite: 0,
  }]);

  logger.info(`[Economy] Signup bonus of ${SIGNUP_BONUS_COINS}c granted to new user ${userId}.`);
  return JSON.stringify({ is_new_player: true, reward_coins: SIGNUP_BONUS_COINS });
}

function initializeSystemConfig(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
  const collection = "system_config";
  const key = "settings";
  const systemUserId = "00000000-0000-0000-0000-000000000000";

  try {
    const result = nk.storageRead([{ collection, key, userId: systemUserId }]);
    if (!result || result.length === 0) {
      nk.storageWrite([{
        collection,
        key,
        userId: systemUserId,
        value: {
          terms_of_service: (globalThis as any).DEFAULT_TERMS_OF_SERVICE,
          privacy_policy: (globalThis as any).DEFAULT_PRIVACY_POLICY,
          eula: (globalThis as any).DEFAULT_EULA,
          min_app_version: "1.0.0",
          latest_app_version: "1.0.0"
        },
        permissionRead: 2, // Public Read
        permissionWrite: 0 // Server Only Write
      }]);
      logger.info("[Config] Default system settings initialized in storage.");
    }
  } catch (e) {
    logger.error(`[Config] Error checking/writing system config: ${e}`);
  }
}

function calculateTier(lp: number): string {
  if (lp < 1000) return "Bronze";
  if (lp < 2000) return "Silver";
  if (lp < 3500) return "Gold";
  if (lp < 5500) return "Platinum";
  if (lp < 8000) return "Elite";
  if (lp < 11000) return "Master";
  return "Prestige";
}

function initializeAchievementsConfig(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
  const collection = "system_config";
  const key = "achievements";
  const systemUserId = "00000000-0000-0000-0000-000000000000";

  try {
    const result = nk.storageRead([{ collection, key, userId: systemUserId }]);
    if (!result || result.length === 0) {
      const defaultAchievements = [
        {
          id: "first_win",
          name: "First Blood",
          des: "Win your first ranked match",
          icon: "⚔️",
          achievement_type: "Combat",
          requirement_type: "wins",
          requirement_value: 1,
          reward_coins: 100,
          gold: false
        },
        {
          id: "wins_100",
          name: "Centurion",
          des: "Reach 100 total wins",
          icon: "💯",
          achievement_type: "Milestone",
          requirement_type: "wins",
          requirement_value: 100,
          reward_coins: 500,
          gold: false
        },
        {
          id: "coins_50k",
          name: "High Roller",
          des: "Amass 50k gold coins",
          icon: "💎",
          achievement_type: "Economy",
          requirement_type: "coins",
          requirement_value: 50000,
          reward_coins: 1000,
          gold: true
        },
        {
          id: "streak_10",
          name: "Unstoppable",
          des: "Achieve a 10-win streak",
          icon: "🔥",
          achievement_type: "Skill",
          requirement_type: "streak",
          requirement_value: 10,
          reward_coins: 300,
          gold: false
        },
        {
          id: "elite_ascent",
          name: "Elite Ascent",
          des: "Reach Elite Tier",
          icon: "👑",
          achievement_type: "Milestone",
          requirement_type: "tier",
          requirement_value: 5500, // Elite start LP
          reward_coins: 700,
          gold: true
        }
      ];

      nk.storageWrite([{
        collection,
        key,
        userId: systemUserId,
        value: { achievements: defaultAchievements },
        permissionRead: 2, // Public Read
        permissionWrite: 0 // Server Only Write
      }]);
      logger.info("[Achievements] Default achievements configuration initialized.");
    }
  } catch (e) {
    logger.error(`[Achievements] Error checking/writing achievements config: ${e}`);
  }
}

function updateAchievementsProgress(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, stats: any): void {
  const systemUserId = "00000000-0000-0000-0000-000000000000";
  let achievementsConfig: any[] = [];
  try {
    const configRead = nk.storageRead([{ collection: "system_config", key: "achievements", userId: systemUserId }]);
    if (configRead && configRead.length > 0) {
      achievementsConfig = configRead[0].value.achievements || [];
    }
  } catch (e) {
    logger.error(`[Achievements] Error reading achievements config: ${e}`);
    return;
  }

  if (achievementsConfig.length === 0) return;

  // Read player progress
  let progress: Record<string, any> = {};
  try {
    const progressRead = nk.storageRead([{ collection: "player_achievements", key: "progress", userId }]);
    if (progressRead && progressRead.length > 0) {
      progress = progressRead[0].value.progress || {};
    }
  } catch (e) {
    logger.error(`[Achievements] Error reading player progress: ${e}`);
  }

  let updated = false;
  let rewardedCoins = 0;

  for (const ach of achievementsConfig) {
    const achId = ach.id;
    if (progress[achId] && progress[achId].unlocked) {
      continue; // Already unlocked
    }

    let currentValue = 0;
    let requirementValue = ach.requirement_value;
    let meetsRequirement = false;

    switch (ach.requirement_type) {
      case "wins":
        currentValue = stats.wins || 0;
        meetsRequirement = currentValue >= requirementValue;
        break;
      case "coins":
        currentValue = stats.coins || 0;
        meetsRequirement = currentValue >= requirementValue;
        break;
      case "streak":
        currentValue = stats.best_streak || 0;
        meetsRequirement = currentValue >= requirementValue;
        break;
      case "tier":
        currentValue = stats.lp || 0;
        meetsRequirement = currentValue >= requirementValue;
        break;
      case "level":
        currentValue = stats.level || 0;
        meetsRequirement = currentValue >= requirementValue;
        break;
    }

    if (meetsRequirement) {
      progress[achId] = {
        unlocked: true,
        unlocked_at: Date.now()
      };
      rewardedCoins += ach.reward_coins || 0;
      updated = true;
      logger.info(`[Achievements] Player ${userId} unlocked achievement: ${ach.name} (+${ach.reward_coins}c)`);
    } else {
      // Update progress value
      if (!progress[achId]) {
        progress[achId] = {
          unlocked: false,
          current_value: currentValue
        };
        updated = true;
      } else if (progress[achId].current_value !== currentValue) {
        progress[achId].current_value = currentValue;
        updated = true;
      }
    }
  }

  if (updated) {
    try {
      nk.storageWrite([{
        collection: "player_achievements",
        key: "progress",
        userId,
        value: { progress },
        permissionRead: 1,
        permissionWrite: 0
      }]);
    } catch (e) {
      logger.error(`[Achievements] Error writing progress: ${e}`);
    }

    if (rewardedCoins > 0) {
      stats.coins += rewardedCoins;
      nk.walletUpdate(userId, { coins: rewardedCoins }, { source: "achievement_unlock" });
      logger.info(`[Achievements] Credited +${rewardedCoins} coins to player ${userId} for achievements.`);
    }
  }
}

function writeMatchHistoryRecord(
  nk: nkruntime.Nakama,
  userId: string,
  matchId: string,
  arenaTier: string,
  won: boolean,
  lpDelta: number,
  coinsPayout: number,
  isPrivate: boolean
): void {
  let history: any[] = [];
  try {
    const read = nk.storageRead([{ collection: "player_match_history", key: "history", userId }]);
    if (read && read.length > 0) {
      history = read[0].value.history || [];
    }
  } catch (e) {
    // History does not exist yet
  }

  const newRecord = {
    match_id: matchId,
    game_mode: isPrivate ? "Private Match" : `Ranked ${arenaTier.charAt(0).toUpperCase() + arenaTier.slice(1)}`,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    score: "", // Can be filled in client
    won,
    lp_delta: lpDelta,
    coins: coinsPayout,
    is_private: isPrivate
  };

  history.unshift(newRecord);
  if (history.length > 20) {
    history = history.slice(0, 20); // Keep last 20 matches
  }

  try {
    nk.storageWrite([{
      collection: "player_match_history",
      key: "history",
      userId,
      value: { history },
      permissionRead: 1,
      permissionWrite: 0
    }]);
  } catch (e) {
    // Silent fail
  }
}

function getAchievementsStatusRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  const systemUserId = "00000000-0000-0000-0000-000000000000";
  let achievementsConfig: any[] = [];
  try {
    const configRead = nk.storageRead([{ collection: "system_config", key: "achievements", userId: systemUserId }]);
    if (configRead && configRead.length > 0) {
      achievementsConfig = configRead[0].value.achievements || [];
    }
  } catch (e) {
    logger.error(`[Achievements] Error reading achievements config RPC: ${e}`);
  }

  let progress: Record<string, any> = {};
  try {
    const progressRead = nk.storageRead([{ collection: "player_achievements", key: "progress", userId }]);
    if (progressRead && progressRead.length > 0) {
      progress = progressRead[0].value.progress || {};
    }
  } catch (e) {
    // Progress not started yet
  }

  const joinedAchievements = achievementsConfig.map((ach) => {
    const prog = progress[ach.id] || { unlocked: false, current_value: 0 };
    return {
      name: ach.name,
      des: ach.des,
      icon: ach.icon,
      unlocked: prog.unlocked,
      unlocked_at: prog.unlocked_at || 0,
      achievement_type: ach.achievement_type,
      requirement: `${prog.current_value || 0} / ${ach.requirement_value}`,
      reward: `${ach.reward_coins} Coins`,
      gold: ach.gold
    };
  });

  return JSON.stringify({ achievements: joinedAchievements });
}

function getMatchHistoryRpc(
  ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const userId = ctx.userId;
  if (!userId) throw new Error("Unauthenticated request.");

  let history: any[] = [];
  try {
    const read = nk.storageRead([{ collection: "player_match_history", key: "history", userId }]);
    if (read && read.length > 0) {
      history = read[0].value.history || [];
    }
  } catch (e) {
    // Empty history
  }

  return JSON.stringify({ match_history: history });
}

function updateAchievementsConfigRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  try {
    const parsed = payload ? JSON.parse(payload) : null;
    if (!parsed || !Array.isArray(parsed.achievements)) {
      return JSON.stringify({ success: false, error: "Invalid payload: missing achievements array." });
    }

    nk.storageWrite([{
      collection: "system_config",
      key: "achievements",
      userId: "00000000-0000-0000-0000-000000000000",
      value: parsed,
      permissionRead: 2, // Public Read
      permissionWrite: 0, // Server Write Only
    }]);

    logger.info("[Economy] Dynamic achievements config updated via admin RPC.");
    return JSON.stringify({ success: true });
  } catch (e) {
    logger.error(`[Economy] Failed to update achievements config: ${(e as Error).message}`);
    return JSON.stringify({ success: false, error: (e as Error).message });
  }
}

function updateSystemSettingsConfigRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  try {
    const parsed = payload ? JSON.parse(payload) : null;
    if (!parsed) {
      return JSON.stringify({ success: false, error: "Invalid empty payload." });
    }

    nk.storageWrite([{
      collection: "system_config",
      key: "settings",
      userId: "00000000-0000-0000-0000-000000000000",
      value: parsed,
      permissionRead: 2, // Public Read
      permissionWrite: 0, // Server Write Only
    }]);

    logger.info("[Economy] Dynamic system settings config updated via admin RPC.");
    return JSON.stringify({ success: true });
  } catch (e) {
    logger.error(`[Economy] Failed to update system settings config: ${(e as Error).message}`);
    return JSON.stringify({ success: false, error: (e as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Module entry point — registers only economy-domain RPCs
// ---------------------------------------------------------------------------

function InitModule(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): void {
  initializer.registerRpc("claim_daily_login",  claimDailyLoginRpc);
  initializer.registerRpc("get_daily_rewards_status", getDailyRewardsStatusRpc);
  initializer.registerRpc("spin_wheel",          spinWheelRpc);
  initializer.registerRpc("buy_cosmetic",        buyCosmeticRpc);
  initializer.registerRpc("ad_callback",         adCallbackRpc);
  initializer.registerRpc("claim_signup_reward", claimSignupRewardRpc);

  // New GDD RPCs
  initializer.registerRpc("apply_ad_multiplier", applyAdMultiplierRpc);
  initializer.registerRpc("start_match",         startMatchRpc);
  initializer.registerRpc("end_match",           endMatchRpc);
  initializer.registerRpc("get_active_match",    getActiveMatchRpc);
  initializer.registerRpc("get_achievements_status", getAchievementsStatusRpc);
  initializer.registerRpc("get_match_history",    getMatchHistoryRpc);
  initializer.registerRpc("update_achievements_config", updateAchievementsConfigRpc);
  initializer.registerRpc("update_system_settings_config", updateSystemSettingsConfigRpc);

  logger.info("[Economy] Economy module loaded successfully.");
}


