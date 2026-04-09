# Water Chemistry Reference for Aquaponics

## Optimal Parameter Ranges

| Parameter | Optimal | Acceptable | Danger Zone |
|-----------|---------|------------|-------------|
| pH | 6.8 – 7.4 | 6.5 – 7.8 | < 6.5 or > 8.0 |
| Ammonia (TAN) | 0 – 0.5 ppm | 0.5 – 1.0 ppm | > 2 ppm |
| Nitrite (NO2) | 0 – 0.5 ppm | 0.5 – 1.0 ppm | > 1 ppm |
| Nitrate (NO3) | 20 – 100 ppm | 5 – 150 ppm | < 5 or > 200 ppm |
| Dissolved Oxygen | 6 – 8 mg/L | 5 – 6 mg/L | < 4 mg/L |
| Temperature | 22 – 28°C | 18 – 30°C | < 15°C or > 32°C |
| Potassium (K) | 10 – 40 mg/L | 5 – 60 mg/L | < 5 mg/L |
| Calcium (Ca) | 40 – 80 mg/L | 20 – 100 mg/L | < 20 mg/L |
| Magnesium (Mg) | 10 – 30 mg/L | 5 – 50 mg/L | < 5 mg/L |
| Iron (Fe) chelated | 2 – 4 mg/L | 1 – 6 mg/L | < 1 mg/L |

---

## pH — The Master Variable

pH controls nutrient availability, ammonia toxicity, and bacterial activity simultaneously. It is the single most important parameter to monitor.

### pH Effects on System Components

**On nitrifying bacteria:**
- Optimal: 7.0 – 8.0
- Acceptable: 6.5 – 8.5
- Below 6.5: bacterial activity drops sharply; cycle can crash
- Below 6.0: near-total bacterial inhibition

**On plant nutrient uptake:**
- Fe, Mn, Zn, Cu: best available at pH 5.5 – 7.0; drops steeply above 7.5
- N, P, K, Ca, Mg, S: broadly available from 6.0 – 8.0
- Mo: actually more available at higher pH

**On ammonia toxicity:**
- Ammonia exists as NH4+ (ionized, non-toxic) and NH3 (un-ionized, toxic)
- At pH 7.0: ~0.6% of total ammonia is toxic NH3
- At pH 7.5: ~2.0% of total ammonia is toxic NH3
- At pH 8.0: ~6.0% of total ammonia is toxic NH3
- Temperature also increases NH3 fraction: higher temp = more NH3

**The aquaponics compromise:** Target 6.8 – 7.2 to balance all three competing needs.

### Why pH Changes (Diagnostics)

**pH rising:**
- Algae photosynthesis (CO2 consumption raises pH during daylight)
- Low CO2 due to over-aeration
- Dissolving carbonate media (limestone, oyster shell)
- Insufficient nitrification (not producing H+ from ammonia oxidation)
- Low fish load

**pH falling:**
- Active nitrification (produces H+ → acidic byproduct)
- Organic matter decomposition
- CO2 buildup (under-aeration)
- Algae die-off or nighttime respiration

### pH Adjustment

**Raise pH:**
- Potassium hydroxide (KOH): fast-acting, also adds K — use carefully in small increments
- Potassium bicarbonate (KHCO3): gentler, also raises KH (alkalinity) — preferred
- Calcium carbonate (CaCO3): very slow, raises both Ca and KH
- Never use lime (calcium hydroxide) — too fast-acting, can spike pH dangerously

**Lower pH:**
- Phosphoric acid: adds some P — use sparingly
- Nitric acid: not recommended (fish toxic at higher concentrations)
- Natural: allow nitrification to lower pH gradually; increase feeding rate

---

## Alkalinity (KH) — The pH Buffer

Alkalinity (carbonate hardness, KH) is the system's ability to resist pH changes.

**Target:** 60 – 120 ppm CaCO3 (5 – 8 dKH)

**What happens when KH is low:**
- pH crashes rapidly when acid is produced
- System becomes unstable and unpredictable
- Bacteria are harmed by rapid pH swings
- **Below 50 ppm: emergency — system is vulnerable to crash**

**Why KH drops in aquaponics:**
- Nitrification consumes alkalinity: each gram of ammonia oxidized consumes ~7g of alkalinity (as CaCO3)
- Rain or RO water additions dilute KH
- Active systems with good nitrification need regular KH replenishment

**Replenishing KH:**
- Potassium bicarbonate (KHCO3): raises KH and adds K — best option
- Sodium bicarbonate (NaHCO3): raises KH — avoid if already high Na
- Calcium carbonate: raises KH slowly — good as a buffer reservoir in media beds

---

## Ammonia — Understanding True Toxicity

**Total Ammonia Nitrogen (TAN)** = NH4+ (ionized, safe) + NH3 (un-ionized, toxic)

Most test kits measure **total ammonia**, not just the toxic NH3 fraction. Always calculate the toxic fraction using pH and temperature.

### Approximate NH3 % of Total Ammonia

| Temp | pH 7.0 | pH 7.5 | pH 8.0 |
|------|--------|--------|--------|
| 20°C | 0.4% | 1.3% | 4.0% |
| 25°C | 0.6% | 2.0% | 6.0% |
| 30°C | 0.9% | 3.0% | 9.0% |

**Example:** TAN = 2 ppm at pH 7.5 and 25°C → NH3 = 2 × 0.02 = 0.04 ppm (acceptable)
**Example:** TAN = 2 ppm at pH 8.0 and 30°C → NH3 = 2 × 0.09 = 0.18 ppm (concerning for fish)

**Safe NH3 threshold:** < 0.05 ppm NH3 for sensitive fish; < 0.3 ppm for tilapia

### When Ammonia Spikes

1. New system not yet cycled
2. Bacterial die-off from: chlorinated water, antibiotics, temperature crash, pH crash
3. Overfeeding relative to biofilter capacity
4. Dead fish decomposing
5. Water change with high-ammonia source water

**Emergency response to ammonia spike:**
1. Stop feeding immediately
2. Do 25-50% water change with dechlorinated water
3. Check pH — bacteria need pH > 6.5 to function
4. Add beneficial bacteria supplement (commercial nitrifying bacteria product)
5. Increase aeration

---

## Nitrite — The Intermediate Poison

Nitrite (NO2) is oxidized by Nitrobacter/Nitrospira to nitrate. It is toxic to fish by blocking oxygen transport in blood (methemoglobinemia).

**Toxic mechanism:** NO2 converts hemoglobin to methemoglobin → fish suffocate despite adequate dissolved oxygen

**Fish symptoms:** Gasping at surface, brown gills, lethargy, death

**Emergency nitrite treatment:**
- Add non-iodized salt (NaCl) at 1:6 ratio of nitrite (mg/L) to salt (g/L)
  - Example: Nitrite = 1 ppm → add 6 g/L salt
- Chloride ions competitively inhibit nitrite uptake at gills
- This buys time; does not solve the underlying cause

---

## Dissolved Oxygen (DO)

DO is consumed by fish, plant roots, and aerobic bacteria. All three require adequate oxygen.

**Critical thresholds:**
- Fish (most species): minimum 5 mg/L; stress below 4 mg/L
- Nitrifying bacteria: minimum 2 mg/L (below this, denitrification can occur)
- Plant roots: minimum 3 mg/L in root zone

**Temperature effect on DO saturation:**
- 20°C: 9.1 mg/L maximum
- 25°C: 8.2 mg/L maximum
- 30°C: 7.6 mg/L maximum
- Hot summers reduce DO capacity — aeration becomes critical

**Signs of low DO:**
- Fish congregate at surface or near aeration sources
- Fish gasping
- Sluggish plant growth (root anoxia)
- Hydrogen sulfide smell (rotten egg) in media bed — anaerobic decomposition

---

## Supplementing Key Nutrients

### Iron (Fe)
- Most commonly deficient micronutrient in aquaponics
- Use chelated form — unchelated iron precipitates above pH 7.0
- **Chelate selection by pH:**
  - Fe-EDTA: effective to pH 6.5
  - Fe-DTPA: effective to pH 7.5 — best for most aquaponics
  - Fe-EDDHA: effective to pH 9.0 — use when pH > 7.5
- Target: 2 – 4 mg/L
- Dose: add 1 mg/L chelated iron, test after 48 hours

### Potassium (K)
- Fish waste provides very little K; almost always needs supplementation in fruiting systems
- Potassium bicarbonate (KHCO3): also raises KH — dual benefit
- Potassium sulfate (K2SO4): pH neutral — use when pH is already adequate
- Target: 10 – 40 mg/L
- Signs of deficiency: brown leaf tips and margins on older leaves

### Calcium (Ca)
- Calcium chloride (CaCl2): raises Ca without affecting pH
- Calcium carbonate: raises Ca and KH slowly
- Target: 40 – 80 mg/L
- Signs of deficiency: tip burn in lettuce, blossom end rot in tomatoes/peppers

### Magnesium (Mg)
- Epsom salt (MgSO4·7H2O): easily available, pH neutral
- Dose: 25 – 50 mg/L per treatment
- Signs of deficiency: interveinal chlorosis on older leaves (yellow between green veins)
