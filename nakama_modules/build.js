const fs = require('fs');
const path = require('path');

const authJs = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
const economyJs = fs.readFileSync(path.join(__dirname, 'economy.js'), 'utf8');
const seasonalJs = fs.readFileSync(path.join(__dirname, 'seasonal.js'), 'utf8');

function stripInitModule(content) {
  const marker = 'function InitModule(';
  const index = content.indexOf(marker);
  if (index !== -1) {
    return content.substring(0, index);
  }
  return content;
}

const cleanAuth = stripInitModule(authJs);
const cleanEconomy = stripInitModule(economyJs);
const cleanSeasonal = stripInitModule(seasonalJs);

const combinedInitModule = `
// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
  // Auth Module hooks
  initializer.registerAfterAuthenticateDevice(onAfterAuthenticate);
  initializer.registerAfterAuthenticateGoogle(onAfterAuthenticate);
  logger.info("[Auth] Auth module loaded successfully.");

  // Economy Module RPCs
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

  // Seasonal RPCs
  initializer.registerRpc("get_seasonal_status",    getSeasonalStatusRpc);
  initializer.registerRpc("claim_seasonal_tier",    claimSeasonalTierRpc);
  initializer.registerRpc("get_weekly_challenges",  getWeeklyChallengesRpc);
  initializer.registerRpc("claim_weekly_challenge", claimWeeklyChallengeRpc);

  logger.info("[Economy] Economy module loaded successfully.");
  logger.info("[Seasonal] Seasonal module loaded successfully.");
  logger.info("[Runtime] All U10 modules initialized successfully.");
}
`;

const result = `// =============================================================================
// U10 Nakama Server — Runtime Bundle (index.js)
// =============================================================================
// Generated dynamically by build.js
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// AUTH DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanAuth}

// ─────────────────────────────────────────────────────────────────────────────
// ECONOMY DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanEconomy}

// ─────────────────────────────────────────────────────────────────────────────
// SEASONAL DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanSeasonal}
${combinedInitModule}
`;

fs.writeFileSync(path.join(__dirname, 'index.js'), result, 'utf8');
console.log('Successfully bundled index.js!');
