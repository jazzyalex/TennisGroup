# Player Card Component Documentation

## Overview
The player card is a compact widget displaying key tennis statistics for a junior player. It appears in the hero section of the Tennis Tracker homepage.

## Structure

```
player-card
├── header
│   ├── player name (h2)
│   └── last updated date
├── divider
├── metrics row (3 columns)
│   ├── UTR block
│   ├── WTN block
│   └── Rankings block
└── bottom row (2 columns)
    ├── USTA Points panel
    └── TR (Tennis Recruiting) panel
```

## Data Blocks

### 1. UTR Block (Universal Tennis Rating)
- **Singles rating**: Primary value, larger font (1.1rem), with trend arrow (↑/↓)
- **Doubles rating**: Secondary value, smaller font (0.9rem)
- **Link**: Opens UTR player profile
- **Data attributes**: `data-player-stat="utr"`, `data-player-stat="utr_doubles"`

### 2. WTN Block (World Tennis Number)
- **Value**: Single number (lower is better, scale 1-40)
- **Trend arrow**: Shows if rating improved (↓) or declined (↑)
- **Link**: Opens USTA player profile
- **Data attribute**: `data-player-stat="wtn"`

### 3. Rankings Block
- **Nat**: National USTA ranking (e.g., #681)
- **NorCal**: Section ranking (e.g., #41)
- **Link**: Opens USTA rankings tab
- **Data attributes**: `data-player-stat="usta_national"`, `data-player-stat="usta_section"`

### 4. USTA Points Panel
- **Total**: Combined singles + doubles points
- **Singles**: Points from singles tournaments
- **Doubles**: Points from doubles tournaments
- **Link**: Opens USTA rankings tab
- **Data attributes**: `data-player-stat="usta_points_total"`, `data-player-stat="usta_points_singles"`, `data-player-stat="usta_points_doubles"`

### 5. TR Panel (Tennis Recruiting)
- **Nat**: National TR ranking
- **CA**: California state ranking
- **Link**: Opens Tennis Recruiting profile
- **Data attributes**: `data-player-stat="tr_national"`, `data-player-stat="tr_california"`

## Trend Indicators
- `player-card__trend--up` (↑): Green color, indicates improvement
- `player-card__trend--down` (↓): Red color, indicates decline
- For UTR: Higher is better, so ↑ is good
- For WTN: Lower is better, so ↓ is good

## CSS Classes

### Container
- `.player-card` - Main card container (max-width: 380px)

### Header
- `.player-card__header` - Flex container for name and date
- `.player-card__name` - Player name (Space Grotesk font)
- `.player-card__updated` - "Updated" date text

### Metrics
- `.player-card__metrics` - 3-column grid for top row
- `.player-card__metric` - Individual metric box
- `.player-card__metric-title` - Block title (UTR, WTN, Rankings)
- `.player-card__metric-value` - Primary value display

### UTR-specific
- `.player-card__utr-values` - Flex container for singles/doubles
- `.player-card__utr-singles` / `.player-card__utr-doubles` - Column containers
- `.player-card__utr-label` - "Singles" / "Doubles" labels
- `.player-card__utr-value` - Large singles value
- `.player-card__utr-value-small` - Smaller doubles value

### Rankings
- `.player-card__ranking-list` - Grid for ranking rows
- `.player-card__ranking-row` - Single ranking row (label + value)

### Bottom Panels
- `.player-card__bottom` - 2-column grid (2fr 1fr)
- `.player-card__panel` - Panel container
- `.player-card__panel--points` - USTA Points panel modifier
- `.player-card__panel-title` - Panel header
- `.player-card__points-grid` - 3-column grid for points
- `.player-card__points-label` - Column label
- `.player-card__points-value` - Point value
- `.player-card__tr-grid` - TR rankings grid
- `.player-card__tr-row` - TR ranking row

## Design Principles
1. **Compact**: Fits within hero section without crossing decorative stripes
2. **Scannable**: Key numbers are prominent with green color
3. **Consistent**: All blocks use same light gray background (#fafafa)
4. **Interactive**: Hover states lift cards slightly with shadow
5. **Accessible**: All interactive elements are links with proper labels

## Updating Player Data
All dynamic values use `data-player-stat` attributes for easy updates via JavaScript or server-side templating. The `data-player-name` and `data-player-updated` attributes on the header elements allow updating the player identity and freshness date.
