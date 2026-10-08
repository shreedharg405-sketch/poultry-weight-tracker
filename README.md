# AVISYNC: Full-Stack Poultry Bodyweight, Uniformity & Shed-Wise Management System

An enterprise-grade cloud system digitizing manual breeder and broiler growth charts, faithfully reproducing **Suguna Foods recording sheets, seasonal standard benchmarks (Weeks 1 to 23), and multi-pen shed aggregation algorithms**.

---

## 1. System Architecture & Target Cloud Deployment

### A. Cloudflare Pages / Workers (Frontend & Edge Layer)
- **Account ID:** `607a4c8239664450331ee2c9de563318`
- **Workers/Pages Subdomain:** `shreedharg405.workers.dev`
- **Framework:** Vite + React 19 + TypeScript + Tailwind CSS (bundled to static `dist/`)
- **Wrangler Configuration:** `wrangler.toml` pre-configured:
  ```toml
  name = "poultry-weight-tracker"
  account_id = "607a4c8239664450331ee2c9de563318"
  compatibility_date = "2026-01-01"
  pages_build_output_dir = "dist"
  ```
- **Deploy to Cloudflare CLI:**
  ```bash
  cd frontend
  npm install
  npm run build
  npx wrangler pages deploy dist --project-name=poultry-weight-tracker
  ```

### B. Render (Backend API & Managed Database)
- **Runtime:** Node.js / Express (TypeScript) with Prisma ORM
- **Infrastructure Blueprint (`render.yaml`):**
  - Web Service pointing to `backend/` directory (`PORT=10000`)
  - Managed PostgreSQL database resource (`poultry-weight-db`)
  - Environment variables: `DATABASE_URL` (dynamic connection string), `PORT=10000`, `CORS_ORIGIN="https://poultry-weight-tracker.pages.dev,https://*.workers.dev,https://shreedharg405.workers.dev"`
- **Git Push to Render:**
  ```bash
  git init
  git add .
  git commit -m "feat: poultry shed-wise bodyweight & uniformity system"
  git remote add origin https://github.com/<your-username>/<repo>.git
  git push -u origin main
  ```
  Connect your repository in the [Render Blueprint Dashboard](https://dashboard.render.com/) with `render.yaml`.

---

## 2. Domain Data & Shed-Wise Hierarchy

$$\text{Farm} \longrightarrow \text{Shed / House (e.g., Shed 1, Shed 2)} \longrightarrow \text{Pens (e.g., Pen A - Female, Pen B - Male)} \longrightarrow \text{Sample Weighing Records (Weeks 1 to 23)}$$

---

## 3. Suguna Foods Seasonal Standard Benchmarks (Weeks 1 to 23)

### Winter Brood / Grow (Aug – Jan), Summer Laying (Feb – Jul)
| Week | Female Weight (g) | Female Gain (g) | Female Feed (g/bird/d) | Male Weight (g) | Male Gain (g) | Male Feed (g/bird/d) |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **W1** | 140 | 100 | 23 | 140 | 100 | 23 |
| **W2** | 260 | 120 | 29 | 320 | 180 | 32 |
| **W3** | 400 | 140 | 35 | 510 | 190 | 43 |
| **W4** | 520 | 120 | 40 | 690 | 180 | 51 |
| **W5** | 630 | 110 | 44 | 850 | 160 | 58 |
| **W6** | 730 | 100 | 46 | 1000 | 150 | 63 |
| **W7** | 830 | 100 | 48 | 1140 | 140 | 67 |
| **W8** | 920 | 90 | 50 | 1270 | 130 | 70 |
| **W9** | 1010 | 90 | 52 | 1400 | 130 | 72 |
| **W10** | 1100 | 90 | 53 | 1530 | 130 | 74 |
| **W11** | 1180 | 80 | 54 | 1650 | 120 | 76 |
| **W12** | 1260 | 80 | 55 | 1770 | 120 | 77 |
| **W13** | 1340 | 80 | 57 | 1880 | 110 | 78 |
| **W14** | 1430 | 90 | 60 | 1990 | 110 | 79 |
| **W15** | 1530 | 100 | 65 | 2110 | 120 | 83 |
| **W16** | 1640 | 110 | 70 | 2240 | 130 | 87 |
| **W17** | 1765 | 125 | 77 | 2390 | 150 | 94 |
| **W18** | 1905 | 140 | 85 | 2550 | 160 | 101 |
| **W19** | 2065 | 160 | 92 | 2720 | 170 | 106 |
| **W20** | 2235 | 170 | 98 | 2890 | 170 | 109 |
| **W21** | 2415 | 180 | 102 | 3050 | 160 | 112 |
| **W22** | 2585 | 170 | 105 | 3200 | 150 | 114 |
| **W23** | 2745 | 160 | 108 | 3340 | 140 | 117 |

### Summer Brood / Grow (Feb – Jul), Winter Laying (Aug – Jan)
| Week | Female Weight (g) | Female Gain (g) | Female Feed (g/bird/d) | Male Weight (g) | Male Gain (g) | Male Feed (g/bird/d) |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **W1** | 140 | 100 | 23 | 140 | 100 | 23 |
| **W2** | 260 | 120 | 29 | 320 | 180 | 32 |
| **W3** | 400 | 140 | 35 | 510 | 190 | 43 |
| **W4** | 530 | 130 | 40 | 690 | 180 | 51 |
| **W5** | 640 | 110 | 44 | 850 | 160 | 58 |
| **W6** | 740 | 100 | 47 | 1000 | 150 | 63 |
| **W7** | 840 | 100 | 49 | 1140 | 140 | 67 |
| **W8** | 940 | 100 | 51 | 1270 | 130 | 70 |
| **W9** | 1040 | 100 | 52 | 1400 | 130 | 72 |
| **W10** | 1130 | 90 | 53 | 1530 | 130 | 74 |
| **W11** | 1220 | 90 | 54 | 1650 | 120 | 76 |
| **W12** | 1310 | 90 | 56 | 1770 | 120 | 77 |
| **W13** | 1400 | 90 | 58 | 1880 | 110 | 78 |
| **W14** | 1500 | 100 | 61 | 1990 | 110 | 79 |
| **W15** | 1610 | 110 | 66 | 2110 | 120 | 83 |
| **W16** | 1730 | 120 | 72 | 2240 | 130 | 87 |
| **W17** | 1865 | 135 | 80 | 2390 | 150 | 94 |
| **W18** | 2020 | 155 | 88 | 2550 | 160 | 101 |
| **W19** | 2190 | 170 | 95 | 2720 | 170 | 106 |
| **W20** | 2370 | 180 | 102 | 2890 | 170 | 109 |
| **W21** | 2550 | 180 | 107 | 3050 | 160 | 112 |
| **W22** | 2720 | 170 | 110 | 3200 | 150 | 114 |
| **W23** | 2880 | 160 | 113 | 3340 | 140 | 117 |

---

## 4. Mathematical Engine & Suguna F-Factor Standard

### F-Value Lookup Table
$$CV (\%) = \frac{\text{Weight}_{\text{heaviest}} - \text{Weight}_{\text{lightest}}}{\bar{x} \times F} \times 100$$

| $N$ Sample Count | F-Factor | $N$ Sample Count | F-Factor | $N$ Sample Count | F-Factor |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **10** | 3.08 | **45** | 4.40 | **80** | 4.87 |
| **15** | 3.54 | **50** | 4.50 | **85** | 4.90 |
| **20** | 3.73 | **55** | 4.57 | **90** | 4.94 |
| **25** | 3.94 | **60** | 4.64 | **95** | 4.98 |
| **30** | 4.09 | **65** | 4.70 | **100** | 5.02 |
| **35** | 4.20 | **70** | 4.76 | **150+** | 5.03 |
| **40** | 4.30 | **75** | 4.81 | | |

*Note: For intermediate counts, linear interpolation is computed automatically.*

### Pen Calculations:
1. **Sample Count:** $N_{\text{pen}} = \sum n_i$
2. **Average Body Weight:** $\bar{x}_{\text{pen}} = \frac{\sum (w_i \times n_i)}{N_{\text{pen}}}$
3. **Pen Uniformity ($\pm 10\%$):** Count birds in $[\bar{x}_{\text{pen}} \times 0.90, \; \bar{x}_{\text{pen}} \times 1.10]$, divided by $N_{\text{pen}} \times 100$
4. **CV%:** Computed using the heaviest and lightest recorded bins with $F$-factor

### Shed-Wise Aggregation Calculations:
1. **Total Shed Sample Birds:** $N_{\text{shed\_sample}} = \sum_{\text{pens}} N_{\text{pen}}$
2. **Total Shed Bird Population:** $P_{\text{total}} = \sum_{\text{pens}} \text{LiveBirds}_{\text{pen}}$
3. **Shed Weighted Average Weight:**
   $$\bar{X}_{\text{shed}} = \frac{\sum_{\text{all pens}} (w_i \times n_i)}{N_{\text{shed\_sample}}}$$
4. **Shed-Wide Uniformity:**
   $$\text{Shed Uniformity (\%)} = \frac{\sum \text{Sample Birds across all pens in } [0.90 \times \bar{X}_{\text{shed}}, \; 1.10 \times \bar{X}_{\text{shed}}]}{N_{\text{shed\_sample}}} \times 100$$
5. **Pen-to-Shed Variance:** Deviation of each pen's average from the shed mean $\left(\frac{\bar{x}_{\text{pen}} - \bar{X}_{\text{shed}}}{\bar{X}_{\text{shed}}} \times 100\right)$. Highlight pens with $> \pm 5\%$ deviation.
6. **Total Shed Daily Feed Required:**
   $$\text{Feed}_{\text{shed}} (\text{kg}) = \sum_{\text{pens}} \left( \frac{\text{LiveBirds}_{\text{pen}} \times \text{StandardFeedPerBird}_{\text{gender, week}}}{1000} \right)$$
   $$\text{Bags Required} = \frac{\text{Feed}_{\text{shed}} (\text{kg})}{50}$$

---

## 5. System Deliverables & API Endpoints

### A. Prisma Schema (`backend/prisma/schema.prisma`)
Contains models for:
- `Farm`
- `Shed`
- `Pen`
- `Flock`
- `BenchmarkStandard`
- `WeighingSession`
- `WeightTally`

### B. Backend REST API Endpoints
- `POST /api/weighing/pen-entry`: Save pen weighing session & tallies
- `GET /api/sheds/:id/summary?week=X`: Real-time shed-level weighted averages, overall uniformity, feed consumption, and pen deviations
- `GET /api/benchmarks?season=X&gender=Y&week=Z`: Fetch benchmark weight, gain, and feed standard
- `GET /api/sheds`: List all sheds and pen counts
- `GET /api/sheds/compare?week=X`: Cross-shed comparative benchmarking
- `GET /api/export/shed/:id/week/:week/csv`: Export CSV report for shed
- `GET /healthz`: Render health probe endpoint

### C. Frontend React Components (`frontend/src/components/`)
- `WeighingGrid.tsx`: Direct digital clone of Suguna 20g/50g tally grid with live uniformity, CV%, and instant bird tally buttons
- `ShedSummaryDashboard.tsx`: Executive dashboard featuring 5 KPI Cards, Pen Comparative Table, Combined Multi-Pen Histogram, and Growth Chart
- `GrowthChart.tsx`: Weeks 1–23 actual shed weight vs. seasonal target curve with female/male toggles and daily feed overlay
- `PaperSheetReplica.tsx`: Authentic printable Suguna Foods recording sheet with pen tally matrix and shed executive summary

---

## 6. Quick Start & Local Development

### 1. Backend:
```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:push
npm run seed
npm run dev # Runs on http://localhost:5000
```

### 2. Frontend:
```bash
cd frontend
npm install
npm run dev # Runs on http://localhost:5173
```
