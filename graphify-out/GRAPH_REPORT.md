# Graph Report - u10-server  (2026-06-01)

## Corpus Check
- 14 files · ~47,980 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 323 nodes · 613 edges · 18 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `147880a8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]

## God Nodes (most connected - your core abstractions)
1. `practice` - 13 edges
2. `starter` - 13 edges
3. `bronze` - 13 edges
4. `silver` - 13 edges
5. `gold` - 13 edges
6. `platinum` - 13 edges
7. `readPlayerStats()` - 11 edges
8. `writePlayerStats()` - 11 edges
9. `readPlayerStats()` - 11 edges
10. `writePlayerStats()` - 11 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (18 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.12
Nodes (30): adCallbackRpc(), applyAdMultiplierRpc(), ARENA_ENTRY_FEES, buyCosmeticRpc(), calculateTier(), claimDailyLoginRpc(), claimSignupRewardRpc(), COSMETIC_CATALOGUE (+22 more)

### Community 1 - "Community 1"
Cohesion: 0.20
Nodes (25): ChallengeDef, SeasonalConfig, TierDef, CHALLENGE_CATEGORIES, CHALLENGE_POOL, claimSeasonalTierRpc(), claimWeeklyChallengeRpc(), getActiveSeason() (+17 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (31): ARENA_CONFIG, ARENA_ENTRY_FEES, adCallbackRpc(), applyAdMultiplierRpc(), ARENA_ENTRY_FEES, buyCosmeticRpc(), calculateTier(), claimDailyLoginRpc() (+23 more)

### Community 3 - "Community 3"
Cohesion: 0.24
Nodes (22): CHALLENGE_CATEGORIES, CHALLENGE_POOL, claimSeasonalTierRpc(), claimWeeklyChallengeRpc(), getActiveSeason(), getISOWeekNumber(), getNextSeason(), getSeasonalConfig() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (26): bronze, badge, badge_color, desc, entry_fee, gradient, height_variant, jackpot (+18 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (13): platinum, badge, badge_color, desc, entry_fee, gradient, height_variant, jackpot (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (60): adCallbackRpc(), applyAdMultiplierRpc(), ARENA_ENTRY_FEES, buyCosmeticRpc(), calculateTier(), CHALLENGE_CATEGORIES, CHALLENGE_POOL, claimDailyLoginRpc() (+52 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (14): arenaDefaults, authJs, cleanAuth, cleanEconomy, cleanEconomyRaw, cleanFriends, cleanSeasonal, economyJs (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.32
Nodes (5): DEFAULT_PLAYER_INVENTORY, DEFAULT_PLAYER_STATS, generateUniqueUsername(), initializePlayerProfile(), onAfterAuthenticate()

### Community 9 - "Community 9"
Cohesion: 0.32
Nodes (5): DEFAULT_PLAYER_INVENTORY, DEFAULT_PLAYER_STATS, generateUniqueUsername(), initializePlayerProfile(), onAfterAuthenticate()

### Community 10 - "Community 10"
Cohesion: 0.33
Nodes (5): Context, Initializer, Logger, Nakama, Session

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (13): practice, badge, badge_color, desc, entry_fee, gradient, height_variant, jackpot (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (13): silver, badge, badge_color, desc, entry_fee, gradient, height_variant, jackpot (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (13): starter, badge, badge_color, desc, entry_fee, gradient, height_variant, jackpot (+5 more)

## Knowledge Gaps
- **125 isolated node(s):** `name`, `badge`, `badge_color`, `entry_fee`, `offer_fee` (+120 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `practice` connect `Community 11` to `Community 4`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `starter` connect `Community 17` to `Community 4`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `name`, `badge`, `badge_color` to the rest of the system?**
  _125 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.1214574898785425 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11666666666666667 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `Community 6` be split into smaller, more focused modules?**
  _Cohesion score 0.07682177348551361 - nodes in this community are weakly interconnected._