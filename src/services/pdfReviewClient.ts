import type {
  PdfReviewFailure,
  PdfReviewRequest,
  PdfReviewResponse,
  PdfReviewSuccess,
} from "../types/PdfReview";
import type { ReviewResult } from "../types/ReviewResult";
import type { Issue, IssueEvidence, IssueEvidenceCompared, IssueEvidenceTraceStep } from "../types/Issue";
import type { IssueSeverity } from "../types/DocumentReview";
import { isHeadCode, type HeadCode } from "../types/Head";

const ENDPOINT = "http://192.168.137.228:5166/api/pdf-review/process";

// ─── Rich EFRAC prompt (new) ──────────────────────────────────────────────────
const STRUCTURED_PROMPT = `You are a strict laboratory-report data validator for EFRAC (Edward Food Research & Analysis Centre Ltd), a NABL-accredited food-testing laboratory. You review every PDF I attach for data-quality and field-level defects only. Return ONLY a single valid JSON object — no prose, no commentary, no markdown code fences.
 
────────────────────────────────────────────────────────
SEVERITY DEFINITIONS  (use exactly these strings)
────────────────────────────────────────────────────────
"error"      → BLOCK: report cannot be approved until resolved.
               Examples: inverted date sequence, verdict contradicts numeric result,
               LOD > LOQ, missing UoM on a numeric result, calibration expired before analysis,
               same ULR + Report No with different content (NABL §7.8.8), forbidden parameter present for matrix.
"warning"    → WARN: should be fixed before issue; reviewer must acknowledge.
               Examples: AMVR–AMVP gap < 21 days, translatable non-canonical UoM,
               amendment date drift, borderline MU case, cation–anion balance off > 10 %, registration delay 2–3 days.
"suggestion" → INFO: no action required but worth noting.
               Examples: analysis performed on a Sunday, turnaround time unusually long,
               significant-figures inconsistency that does not affect verdict.
 
────────────────────────────────────────────────────────
REPORT IDENTITY & DOCUMENT CONTROL (L1-M1)
────────────────────────────────────────────────────────
• Report number must conform to EFRAC/<Lab>/<YYMMDD><Serial>. Lab code must be from: FDS, MT, RA, WTR, MB, ENV, Gas, DR, VLDN, GOV, DXN. Invalid format or unknown lab code → "error".
• ULR (Unique Lab Reference) must be present and well-formed (NABL format: ULR-TC<accNo><year><serial>F) on every sub-lab section. Missing or malformed → "error".
• NABL logo, ILAC-MRA logo, and TC-5817 stamp must appear on every page. Missing → "error".
• Page numbering must be sequential (Page X of N) with no missing pages. Gaps → "warning".
• Doc-control code (QA.15.0.0.3 or current version) must appear in the top-right of every page. Missing → "warning".
• Header/footer must include customer name, address, attention, report number, issue date, and reference date on every page. Missing fields → "warning".
• "End of Test Report" marker must appear before the T&C page. Missing → "warning".
• Amendment rule: same Report No + same ULR + different content = NABL §7.8.8 violation → "error" (must use new identifier). Customer address silently changed between versions → "error". Parameter values changed without analysis-date change → "error" (physically impossible).
• Pages missing EFRAC/AQIMA brand strip → "error".
 
────────────────────────────────────────────────────────
DATE LOGIC & CHAIN OF CUSTODY (L1-M2)
────────────────────────────────────────────────────────
• Date sequence must hold: Sampling ≤ Receipt ≤ Registration ≤ Analysis Start ≤ Analysis Completion ≤ Issue Date. Any inversion → "error". Receipt > Registration is a BLOCK (reverse-date pattern).
• Registration delay: 0–1 day = PASS; 2–3 days = "warning"; ≥4 days = "error".
• Calibration validity end date must be ≥ Analysis Completion date for every instrument cited. Expired calibration during analysis → "error" (ROUTINE_COA) or "warning" (other classes).
• For Pharma method-validation reports (AMVR referencing AMVP): gap between AMVP issue date and AMVR issue date must be ≥ 21 days. Gap < 21 days → "warning".
• Amendment (v2, v3 …): if analysis completion date is unchanged between versions but result values changed → "error".
• Issue Date must not be a future date → "error".
• Holding-time compliance per parameter type: Microbiology (water) ≤24h; Coliform ≤30h; BOD ≤48h; COD ≤28d; Cr(VI) ≤24h; VOCs in water ≤14d; Metals ≤6 months; Residual Free Chlorine ≤15 min (field only); pH/Temp/DO = field measurement only. Violation → "error".
• All sub-lab registration dates and receipt dates must be identical across sub-lab sections. Mismatch → "error".
• Sub-lab analysis windows must be plausible: Sterility requires ≥14 days, BOD ≥5 days, Dioxin (USEPA 23A) ≥12 days. Shorter windows → "warning".
• Manufacturing Date < Receipt Date < Use-By Date must hold. Sample outside shelf life → "warning".
• Analysis on a Sunday or public holiday → "suggestion" (flag only, do not block).
• Turnaround time (Receipt → Issue) exceeding matrix-typical norms → "suggestion".
 
────────────────────────────────────────────────────────
MATRIX-PARAMETER APPLICABILITY (L1-M3)
────────────────────────────────────────────────────────
• Every tested parameter must be applicable to the sample matrix. Examples of forbidden parameters:
  - Packaged Drinking Water (PDW): Protein, Fat, Carbohydrate, Vitamins, Amino acids, Sugars, Cholesterol, Fatty acids, Caffeine, Alcohol → "error".
  - PDW: Aflatoxin → "error". Methyl Mercury for non-seafood matrices → "error".
• Mandatory parameters must be present for the matrix:
  - PDW per FSSAI 2.10.8: Coliform, TPC, pH, TDS, Hardness, heavy metals panel, 31-compound pesticide panel + Total, Gross Alpha (≤0.1 Bq/L), Gross Beta (≤1.0 Bq/L) → absence of any mandatory parameter → "error".
  - RTE foods: Listeria monocytogenes mandatory. Raw meat: Salmonella + E. coli O157. Dairy: S. aureus + B. cereus + Salmonella. PDW: 12-organism microbial panel.
• Speciation completeness: if Methyl Mercury is reported, Total Mercury must also be reported (Total Hg ≥ Methyl Hg). Cr(VI) ≤ Total Cr. Inorganic As ≤ Total As → "error" if violated.
• Fortification claim: declared nutrient must be >LOQ and within label ±20% per FSSAI +F logo rules → "error" if violated.
• Label claim match: results must not contradict declared label claims → "error".
• GMO-free claim + GMO 35S/NOS detected → "error". Organic claim + prohibited substance detected → "error".
• Result plausibility vs sample type: PDW TPC >100 CFU/mL = alarming flag; honey moisture >25% = implausible → "warning".
• Fatty acid pattern vs matrix: Fish → high EPA/DHA; coconut → high lauric; olive → high oleic. Significant mismatch → "warning".
 
────────────────────────────────────────────────────────
INTER-PARAMETER NUMERICAL RULES (L1-M4 — apply whichever are checkable from visible data)
────────────────────────────────────────────────────────

PROXIMATE / COMPOSITIONAL (4.A)
• Protein + Fat + Carbohydrate + Moisture + Ash ≈ 100% (±2%) on as-such basis → "warning" if outside.
• Carbohydrate (by difference) = 100 − (Protein+Fat+Moisture+Ash) ±0.5% → "warning".
• Total Carbohydrate ≥ Total Sugar ≥ Reducing Sugar → "warning" if violated.
• Total Sugar ≥ Σ(Glucose+Fructose+Sucrose+Lactose+Maltose) → "warning".
• Carbohydrate-sum check (always attempt, fallback-aware): locate the Result for "Carbohydrate" (or "Total Carbohydrate") and     "Total Sugar" (or "Total Sugars" / "Sugar"). Also search for "Dietary Fibre" (or "Total Dietary Fibre" / "Fibre" / "Crude Fibre") • match any of these name variants as the same parameter. 
  • If BOTH Sugar and Fibre are found with numeric Results: Carbohydrate must be ≥ (Sugar + Fibre). Violation → "warning".
  • If ONLY Sugar is found (Fibre genuinely absent from the report — not just unmatched): fall back to Carbohydrate ≥ Sugar alone. Violation → "warning".
  • If ONLY Fibre is found (Sugar absent): fall back to Carbohydrate ≥ Fibre alone. Violation → "warning".
  • Always use the actual numeric values found in the rows for this specific report — never invented or example numbers.
  • Illustrative example ONLY (use real row values, not these numbers): if Sugar=41.30 and Fibre=4.02, then Carbohydrate must be ≥45.32. A reported Carbohydrate of 40.27 violates this since 40.27 < 45.32.
  • Show in evidence.compared which of Sugar/Fibre were found and used, the threshold calculated, and the actual Carbohydrate result.
• Total Fat ≥ Σ(SFA+MUFA+PUFA+Trans Fat) within ±10% → "warning".
• Total Fat ≥ Σ(individual fatty acids — FAME sum) → "warning".
• Total Protein ≥ any single Amino Acid; Total Protein ≥ Σ(individual amino acids) → "warning".
• Dry basis value > as-such value for every nutrient (except moisture) → "warning" if violated.
• Moisture must only be reported on as-such basis, never dry basis → "warning".
• Ash ≥ Σ(individual minerals after unit conversion to same basis) → "warning".
• Energy = (Protein×4)+(Carbs×4)+(Fat×9) ± 2 kcal/100g (Atwater) → "warning" if outside.
• Salt (NaCl) ≥ Sodium × 2.5 when both reported → "warning" if violated.
• kJ = kcal × 4.184 ± 1 kJ → "suggestion" if inconsistent.

WATER CHEMISTRY (4.B)
• TDS ionic-sum check (always attempt if ≥1 ion present): fixed ion list = Chloride, Sulphate(s), Alkalinity, Calcium, Magnesium (match any naming variant, e.g. "Calcium (Ca)", "Alkalinity (CaCO3)"). Find whichever of these five are present with a numeric Result in the rows — could be 1, 2, 3, 4, or 5 of them. Sum only the numeric values found (ignore UOM entirely; exclude any ion reported as BLQ/"<X"/ND from the sum but still run the check using the rest). TDS Result must be ≥ this sum. Violation → "error". Skip only if ZERO of the five ions have a numeric Result anywhere in the rows.
  Example: Chloride=5.26, Sulphate=6.05, Alkalinity=192.91, Calcium=53.42, Magnesium=13.81 → Σ=271.45. TDS=52 violates the rule since 52 < 271.45 → "error".
  Show in evidence.compared which ions were used, their values, the calculated sum, and the TDS value.
• Total Hardness = Calcium Hardness + Magnesium Hardness ± rounding → "warning".
• Total Hardness > Calcium Hardness alone AND > Magnesium Hardness alone → "warning".
• TDS ≈ 0.5–0.7 × Conductivity (µS/cm) for natural waters — e.g. Conductivity 1280 µS/cm implies expected TDS range of 640–896 mg/L. Reported TDS outside this computed range → "warning".
• Ionic balance (±10%): Σcations (meq/L) ≈ Σanions (meq/L). Cations: Ca²⁺, Mg²⁺, Na⁺, K⁺. Anions: HCO₃⁻, CO₃²⁻, Cl⁻, SO₄²⁻, NO₃⁻. Deviation >10% → "warning"; >20% → "error".
• BOD ≤ COD (always — BOD is a subset of total oxygen demand) → "error" if violated.
• BOD/COD ratio 0.1–0.8 typical for wastewater; outside → "warning".
• Turbidity >1 NTU AND Taste reported as "Agreeable" → contradiction → "warning".
• Residual Free Chlorine detectable >0.05 mg/L AND Odour reported "Odourless", "Agreeable", or "Pleasant" (no chlorine/chemical odour noted) → contradiction → "warning".
• Residual Free Chlorine >0.05 mg/L while Odour is reported as Odourless/Agreeable/Pleasant: flag "Chlorine is typically detectable by odour above 0.05 mg/L; reported Odour is inconsistent with the RFC result" → "warning".
• Colour Result >5 Hazen but Description states "colourless": flag "Colour result indicates coloured sample; description should be updated to reflect visible colour" → "warning".
• Colour Result ≤5 Hazen but Description states "coloured" (or omits colourless where matrix expects it): flag "Colour result is within colourless threshold; description should confirm colourless appearance" → "warning".
• Free Cl₂ ≤ Total Cl₂ → "warning" if violated.
• pH 6.5–8.5 for PDW per FSSAI 2.10.8; outside → "error".
• TDS 75–500 mg/L for PDW per FSSAI 2.10.8. Outside range → "error".
• Alkalinity ≥ Carbonate + Bicarbonate → "warning" if inconsistent.

HEAVY METAL & SPECIATION (4.C)
• Total Hg ≥ Methyl Hg → "error" if violated. If Methyl Hg result changes from BLQ to a numeric value, verify Total Hg is still ≥ that numeric value.
• Total As ≥ Inorganic As ≥ Σ(As³⁺+As⁵⁺) → "error" if violated.
• Total Cr ≥ Cr(VI) → "error" if violated.

PESTICIDE / RESIDUE (4.D)
• Total DDT ≥ Σ(2,4-DDT + 4,4-DDT + DDD isomers + DDE isomers) within rounding — if any individual DDT isomer result changes from BLQ to a numeric value, Total DDT must be revised to reflect the updated sum → "warning" if Total DDT < Σ(individual DDT isomers).
• Σ(α+β+γ+δ HCH) = Total HCH → "warning" if mismatched.
• Σ(Phorate+Sulfoxide+Sulfone) = "Phorate (sum of)" per FSSR definition → "warning".
• Total Pesticide Residue ≥ each individual pesticide reported → "warning".
• Matrix = chilli/grape/tea/basmati → ETO (ethylene oxide) panel mandatory → "warning" if absent.

MICROBIOLOGY (4.E)
• TPC ≥ Σ(specific organism counts reported as CFU) → "warning" if violated.
• E. coli ⊂ Coliforms — two directional checks, both mandatory:
  • If Total Coliforms = Absent/Not Detected → E. coli MUST also be Absent/Not Detected. E. coli present when Coliforms absent is physically impossible → "error".
  • If E. coli = Detected/Present → Total Coliforms MUST also be Detected/Present. E. coli detected but Coliforms absent or not reported is physically impossible → "error".
  Note: Coliforms Detected + E. coli Absent is scientifically valid (not all Coliforms are E. coli) and must NOT be flagged as a violation.
• If a microbiology result for E. coli or Coliforms changes between report versions (e.g. from Detected to Absent) without a corresponding change in analysis date → "error" (physically impossible re-classification without re-analysis).
• TYMC ≥ Yeast count alone; TYMC ≥ Mould count alone → "warning".
• PDW: any pathogen present = Critical OOS → "error".

FOOD CONTACT / PACKAGING (4.F)
• Overall Migration (material) ≤ 10 mg/dm² per IS 9845 → "error" if exceeded.
• Overall Migration (simulant) ≤ 60 mg/L per IS 9845 → "error" if exceeded.
• Migration test duration must be ≥ 10 days — cannot be done overnight → "error".

GAS / CO₂ ISBT (4.G)
• Purity ≥ 99.9% v/v (ISBT food-grade CO₂) → "error" if below.
• Total VOCs (Benzene+Toluene+Xylenes+Ethylbenzene) ≤ ~50 ppb v/v aggregate → "error".
• Benzene ≤ 20 ppb v/v → "error" if exceeded.
• Acetaldehyde ≤ 0.2 ppm v/v → "error" if exceeded.
• Σ(individual mercaptans) ≤ Total Sulphur → "warning".

ROOT-CAUSE CONSOLIDATION: When multiple inter-parameter failures share a common upstream value (e.g., wrong unit of measure cascading into sum-balance failures), compose a single root-cause finding rather than listing each failure separately.
• Protein ≈ Kjeldahl N × conversion factor (5.7 for wheat, 6.38 for dairy, 6.25 default). Wrong factor or unexplained deviation → "warning".
 
────────────────────────────────────────────────────────
REGULATORY CITATION & METHOD REFERENCE (L1-M5)
────────────────────────────────────────────────────────
• Standard cited must match matrix: FSSAI 2.10.8=PDW; 2.10.7=PNMW; 2.10.6=beverages; IS 9845=plastic FCM; IS 12252=PET; ISBT=CO₂; IS 14543=PDW; IS 13428=PNMW → "error" if mismatched.
• Method namespace must match sub-lab: FD=Food; WTR=Water; MB=Microbiology; DR=Drug; GAS=Gas. Cross-namespace usage → "error".
• FSSAI Lab Manual citation must include Vol+Chapter (e.g., FSSAI Manual 10.013:2021) → "warning" if format incomplete.
• EPA method citations must include version (USEPA 23A, EPA 524.3) → "warning" if absent.
• ISO citations must include year (ISO 21528-2:2017) → "warning" if absent.
• In-house methods (QA.x.y / FD.x.y / MB.x.y) must cite parent method (AOAC/APHA/IS/EPA) in NABL scope → "warning".
• Every parameter+method+matrix combination must be within NABL accreditation scope. Non-scope parameters must be marked with asterisk → "error" if not flagged.
• ULR must contain accreditation number TC-5817 → "error" if absent.
• Export samples: check destination-specific regulator requirements (USFDA/TGA/EU FCM/Japan PRA/GACC) → "warning" if missing.
• APEDA/EIC/Agmark/FSSAI ID/BIS Lic — if sample carries these, must appear on report → "error" if absent.
 
────────────────────────────────────────────────────────
SPEC & VERDICT CONSISTENCY (L1-M6)
────────────────────────────────────────────────────────
• Every numeric result must be compared against its stated specification (NMT / NLT / range). If result breaches spec but verdict says "Conforms" → "error". If result is within spec but verdict says "Does Not Conform" → "error".
• Qualifier-bearing results (BLQ, BDL, "< X"): treated as passing NMT specs only when the qualifier threshold ≤ spec limit. If qualifier threshold > spec limit and verdict is "Conforms" → "error".
• Decision rule with Measurement Uncertainty (MU): if result + MU crosses the spec limit, borderline verdict without explicit decision-rule declaration → "warning".
• Front-page summary verdict must reflect the worst-case verdict across all sub-lab sections. If front page says Conforms but any sub-lab section says Does Not Conform → "error".
• OOS results must be bold per EFRAC convention. Non-bold OOS result → "error".
• Every parameter must have a Requirements value stated or "No regulatory limit prescribed". Blank Requirements column → "error".
• IS 10500 two-tier spec (AL/PL): AL=PASS; AL<result≤PL="Permissible without alternate source"; result>PL=REJECTED → "error" if verdict does not match tier.
• Customer internal spec (narrower than regulatory) must be applied with citation → "warning" if not applied.
 
────────────────────────────────────────────────────────
LOQ / LOD / MU COMPLETENESS (L1-M7)
────────────────────────────────────────────────────────
• Where a method requires LOQ: if LOQ is absent → "error".
• LOD must be ≤ LOQ. If LOD > LOQ → "error".
• LOQ and LOD must share the same unit of measure as the result. Unit mismatch → "error".
• For Pharma reports (decision-rule context): LOQ must be ≤ 10 % of the specification limit. LOQ > 10 % of spec → "error".
• MU value absent when decision rule is declared → "warning".
• Numeric value below LOQ must be expressed as "<LOQ" or "BLQ", not as "0" or a raw number → "warning".
• LOQ adequacy: LOQ >50% of spec limit = critically inadequate → "warning". LOQ = spec limit = BLQ cannot confirm compliance at boundary → "warning".
• LOD and LOQ must not be used interchangeably. LOQ ≈ 3× LOD; if used interchangeably → "warning".
• Significant figures must match method precision — no extra digits beyond instrument resolution → "suggestion".
 
────────────────────────────────────────────────────────
UNIT OF MEASURE HYGIENE (L1-M8)
────────────────────────────────────────────────────────
• Every numeric result must carry a unit of measure. Missing UoM → "error".
• UoM must be consistent for the same parameter across pages and sub-lab sections. Inconsistency → "warning" if translatable (e.g., mg/L vs ppm for water), "error" if not translatable.
• Unit-matrix consistency: Solids: mg/kg, mg/100g, %; Liquids: mg/L, mg/100mL, %v/v; Gas: ppm v/v; Surface: mg/dm². Mismatch → "error".
• mg/mL vs mg/L confusion (mg/mL = 1000× mg/L) → "error" if mixed.
• ppm vs ppb confusion (1 ppm = 1000 ppb) → "error" if inconsistent in the same panel.
• CFU/g for solids; CFU/mL for liquids — never mixed → "warning".
• ppm v/v specifically for gases only — not for liquids or solids → "warning".
• Decimal separator must be consistent throughout (period or comma, not mixed) → "warning" if mixed.
• Significant figures must be consistent for the same parameter across versions or sub-lab sections. Inconsistency → "suggestion".
• Non-canonical but translatable UoM (e.g., "ppm" instead of "mg/L" for water) → "suggestion" with the canonical form stated.
 
────────────────────────────────────────────────────────
DATA INTEGRITY & ANTI-FABRICATION (L1-M9)
────────────────────────────────────────────────────────
• Decimal pattern lock: ≥5 unrelated parameters sharing identical decimal portion (.00, .50, .25) → "error".
• Identical-to-prior-batch: current values identical to prior batch to 4+ decimals across multiple parameters → "error".
• Sequential arithmetic pattern in results (5.01, 5.02, 5.03…) → "error".
• 3+ unrelated parameters with exact same numeric value → "error".
• Time-stamp impossibility: total analysis time < method cycle time (e.g., HPLC 25-min × 30 samples cannot finish in 2h) → "error".
• Result rounding to suspicious precision (5.0000 vs 5 — resolution mismatch) → "warning".
• Same value reported across different sub-labs for the same shared parameter (e.g., Moisture from both MB and WC) — must reconcile → "warning".
NOTE: Do NOT speculate about intent. State observations only. Do not use the word "fraud".
 
────────────────────────────────────────────────────────
CONFORMANCE & REMARKS (L1-M10)
────────────────────────────────────────────────────────
• Auto-attach triggers:
  - Tin result = LOQ (e.g., Sn=0.05, LOQ=0.05): flag "Tin reported at LOQ; verify by re-test" → "warning".
  - Methyl Mercury AND Total Mercury both reported: flag "Methyl Mercury speciation method differs from Total Hg method" → "suggestion".
  - FSSAI surveillance ID present: flag "FSSAI surveillance sample — chain of custody to be maintained" → "warning".
  - PET migration report: flag "PET-Sb context: low Sb indicates virgin resin or Ge/Ti-catalysed PET" → "suggestion".
  - Any sub-lab OOS but front page shows Conforms: flag "One or more sub-lab sections show Non-Conformance; overall verdict must be updated" → "error".
 
────────────────────────────────────────────────────────
SIGNATORY & AUTHORISATION (L1-M11)
────────────────────────────────────────────────────────
• Every sub-lab section must carry a digital or wet signature → "error" if absent.
• Signatory must be in the current NABL-authorised list for EFRAC.
• Signatory discipline must match the sub-lab: Avishek Biswas=Microbiology; Sibsankar Mandal=Phys-Chem; Tarun Tiwari=Metals+Pesticides; Ranadip Chakraborty=Phys-Chem; Kaushik Mondal=Gas/Migration. Cross-discipline signing → "error".
• OOS/non-conforming reports require both Approver AND QA signatory (two-person rule) → "error" if only one present.
• Signature must be within the signatory's validity window (valid_from ≤ issue_date ≤ valid_till) → "error" if outside.
• Reviewer must NOT be the same person as the signatory (segregation rule) → "error" unless Lab Director override.
 
────────────────────────────────────────────────────────
CUSTOMER & SAMPLE METADATA INTEGRITY (L1-M12)
────────────────────────────────────────────────────────
• Kind Attention field must start with a valid salutation: Mr./Mrs./Ms./Dr./Prof./Capt./Maj./Col./Rev./Hon./Shri/Smt./M/s. Bare name without salutation → "error".
• Kind Attention must have at least 2 tokens after the salutation (Salutation + First + Last name minimum) → "warning" if only one token.
• Customer Name and Address must match the TRF (Test Request Form) exactly → "error" if mismatched.
• Sample Type/Description must match TRF verbatim → "error" if mismatched.
• Batch No / Mfg Date / Use-By must match TRF → "error" if mismatched.
• Sample Quantity Used must be ≤ Sample Quantity Received → "error" if violated.
• Sample Quantity Received must be plausible for the scope of testing (1L water cannot support 84 parameters) → "warning".
• Sample Condition notation must be present ("Fit for Analysis" or specific condition) → "warning" if absent.
• At least one of "Sample Drawn by" or "Sample Submitted by" must be populated → "warning" if both blank.
• Sampling Method must be declared: lab-sampled = cite IS 1070/APHA 1060; client-submitted = state "Client-submitted" → "warning" if missing.
• Standard/Guideline Applied must not be blank for regulated samples (e.g., "N/A" when ISBT applies) → "warning".
 
────────────────────────────────────────────────────────
VOICE RULES (follow exactly)
────────────────────────────────────────────────────────
For each finding:
1. Title: one-line issue summary, 12–20 words.
2. Description: 2–3 sentences. Cite specific values, dates, page numbers, and the rule being checked. Past tense for events, present tense for current state. No semicolons. No editorialising ("this is serious"). No speculation beyond the data.
3. Suggestion: one sentence telling the reviewer exactly what to do.
Expand abbreviations on first use within each finding (e.g., "Limit of Quantitation (LOQ)", "Measurement Uncertainty (MU)").

────────────────────────────────────────────────────────
EVALUATION HEADS  (classify every finding into exactly one)
────────────────────────────────────────────────────────
IDENTITY    — Identity & document integrity (ULR, report number, structural completeness, NABL symbol, page control, sample/batch ID, signatory authorisation, customer metadata)
DATES       — Date & workflow logic (sequence, sampling/receipt/registration/analysis/issue dates, calibration validity, holding times, sub-lab date consistency)
PARAMS      — Inter-parameter conflicts (proximate sums, cation-anion balance, TDS/conductivity, fat/sugar/protein sums, microbiology subsets, speciation hierarchy, spec vs verdict, LOD/LOQ/MU, UoM, gas purity limits)
MATRIX      — Matrix vs parameter applicability (forbidden params for matrix, mandatory panel absence, fortification/label claim mismatch, GMO/organic conflict, result plausibility vs matrix)
REGULATORY  — Regulatory & method references (FSSAI codes, IS/ISO/EPA/APHA method versions, NABL scope, accreditation scope match, export regulator requirements)
HYGIENE     — Signatory & hygiene (signatures, stamps, conformance remark type, auto-attach comments, decimal/sig-fig hygiene, language, data-integrity anomalies)

Schema:
{
  "documents": [
    {
      "fileName": "<exact original filename>",
      "score": <integer 0-100>,
      "summary": "<2-3 sentence overall assessment>",
      "metadata": {
        "reportNo":          "<Report number / Certificate No — exact as printed, else null>",
        "ulr":               "<Unique Lab Reference / ULR number, else null>",
        "customer":          "<Customer / Client name, else null>",
        "sample":            "<Sample description / Product name, else null>",
        "sampleId":          "<Sample ID / Batch No / Lot No if present, else null>",
        "issuedDate":        "<Issue Date as printed e.g. 14/04/2026, else null>",
        "samplingDate":      "<Sampling / Collection date if present, else null>",
        "receiptDate":       "<Date of receipt at lab if present, else null>",
        "analysisStartDate": "<Analysis start date if present, else null>",
        "analysisEndDate":   "<Analysis completion / end date if present, else null>",
        "subLabs":           "<Sub-lab codes e.g. WC MB comma-separated, else null>",
        "documentClass":     "<Document class e.g. Routine COA Reanalysis v2, else null>",
        "nabl":              "<NABL accreditation number if shown, else null>",
        "method":            "<Primary test method / standard if shown, else null>",
        "matrix":            "<Sample matrix e.g. Packaged Drinking Water, else null>",
        "version":           "<Report version e.g. v1 v2 if shown, else null>"
      },
      "issues": [
        {
          "headCode": "IDENTITY" | "DATES" | "PARAMS" | "MATRIX" | "REGULATORY" | "HYGIENE",
          "severity": "error" | "warning" | "suggestion",
          "title": "<short title>",
          "description": "<what is wrong and why it matters>",
          "location": "<e.g. 'Page 3 — Section 5.2: Authorization'>",
          "suggestion": "<concrete fix>",
          "page": <1-based page number, optional>,
          "evidence": {
            "compared": [ { "label": "<field name>", "old": "<previous value>", "new": "<current value>" } ],
            "verdict":  "<one-line reason the rule fired>",
            "rule":     { "code": "<short rule code, e.g. R-DATE-01>", "version": "v1.0" }
          }
        }
      ]
    }
  ],
  "overallScore": <integer 0-100, average of document scores rounded>
}

Rules:
- Emit one entry in "documents" per uploaded PDF, in the order I uploaded them, using the exact original filename.
- score: 100 = ready to submit, 0 = unusable. Penalize missing required fields, compliance gaps, formatting inconsistencies, factual issues, structural problems.
- Produce 4-8 issues per document, distributed across the heads where evidence exists. Keep each "description" and "suggestion" to 1-2 sentences (max ~240 chars each).
- Always include "headCode". When a finding compares concrete values (a result vs spec, a date vs another date, a parameter across versions, etc.) you MUST populate "evidence.compared" with the actual values; otherwise omit "evidence" or include only "verdict" + "rule".
- Rule codes follow the EFRAC manual section: dates → R-DATE-NN, inter-parameter → R-PARAM-NN, spec/verdict → R-SPEC-NN, LOQ/MU → R-LOQ-NN, UoM → R-UOM-NN, identity → R-ID-NN, regulatory → R-REG-NN, hygiene → R-HYG-NN. Use v1.0 if unknown.
- "error" blocks acceptance; "warning" should be fixed; "suggestion" is a polish/improvement.
- All string values MUST be valid JSON: escape every internal double-quote as \\" and every newline as \\n. Do NOT include literal newlines, tabs, or unescaped quotes inside any string.
- Output raw JSON only. Do not wrap in \`\`\` and do not add any text before or after. Do not truncate — finish every brace and bracket.
- Every "documents" entry MUST include a "metadata" object. All metadata values must be strings or null — never omit the metadata object even if all values are null.`;


// ─── Metadata type ─────────────────────────────────────────────────────────
export interface ReportMetadata {
  reportNo:           string | null;
  ulr:                string | null;
  customer:           string | null;
  sample:             string | null;
  sampleId:           string | null;
  issuedDate:         string | null;
  samplingDate:       string | null;
  receiptDate:        string | null;
  analysisStartDate:  string | null;
  analysisEndDate:    string | null;
  subLabs:            string | null;
  documentClass:      string | null;
  nabl:               string | null;
  method:             string | null;
  matrix:             string | null;
  version:            string | null;
}

// ─── Error class ──────────────────────────────────────────────────────────────
export class PdfReviewError extends Error {
  readonly correlationId: string;
  readonly errorCode: string;
  readonly status: number;
  readonly validationErrors?: Record<string, string[]>;

  constructor(failure: PdfReviewFailure, status: number) {
    super(failure.message);
    this.name = "PdfReviewError";
    this.correlationId = failure.correlationId;
    this.errorCode = failure.errorCode;
    this.status = status;
    this.validationErrors = failure.validationErrors;
  }
}

function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Transport (identical to the old working client) ─────────────────────────
// NOTE: No maxTokensOverride — backend doesn't accept it.
export async function reviewPdfs(
  req: PdfReviewRequest,
  signal?: AbortSignal,
): Promise<PdfReviewSuccess> {
  const form = new FormData();
  for (const f of req.files) {
    form.append("files", f);
  }
  form.append("prompt", req.prompt);
  if (req.systemPrompt) form.append("systemPrompt", req.systemPrompt);
  if (req.modelOverride) form.append("modelOverride", req.modelOverride);
  // maxTokensOverride intentionally omitted — backend rejects it
  if (req.correlationId) form.append("correlationId", req.correlationId);
  if (typeof req.deleteFilesAfter === "boolean") {
    form.append("deleteFilesAfter", String(req.deleteFilesAfter));
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    body: form,
    signal,
  });

  let payload: PdfReviewResponse | null = null;
  try {
    payload = (await res.json()) as PdfReviewResponse;
  } catch {
    // non-JSON failure (network / HTML error page)
  }

  if (!res.ok || !payload || payload.success === false) {
    const failure: PdfReviewFailure =
      payload && payload.success === false
        ? payload
        : {
            correlationId: req.correlationId ?? "",
            success: false,
            errorCode: res.status === 429 ? "AI_RATE_LIMIT" : "INTERNAL_ERROR",
            message:
              res.status === 429
                ? "Rate limit reached. Please retry in a moment."
                : `Request failed (${res.status}).`,
          };
    throw new PdfReviewError(failure, res.status);
  }

  return payload;
}

// ─── JSON recovery helpers (ported from new client) ──────────────────────────

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  // fallback: pull first balanced {...} block
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function escapeControlCharsInStrings(input: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = ch.charCodeAt(0);
    if (inString) {
      if (escape) { out += ch; escape = false; continue; }
      if (ch === "\\") { out += ch; escape = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (code === 0x0a) { out += "\\n"; continue; }
      if (code === 0x0d) { out += "\\r"; continue; }
      if (code === 0x09) { out += "\\t"; continue; }
      if (code === 0x08) { out += "\\b"; continue; }
      if (code === 0x0c) { out += "\\f"; continue; }
      if (code < 0x20)   { out += "\\u" + code.toString(16).padStart(4, "0"); continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    out += ch;
  }
  return out;
}

function recoverTruncatedJson(input: string): string {
  let inString = false;
  let escape = false;
  let stringOpenIndex = -1;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = false; stringOpenIndex = -1; continue; }
      continue;
    }
    if (ch === '"') { inString = true; stringOpenIndex = i; continue; }
  }

  let out = input;
  if (inString && stringOpenIndex >= 0) {
    out = out.slice(0, stringOpenIndex);
    out = out.replace(/\s+$/, "");
    out = out.replace(/,?\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "");
    out = out.replace(/[,:]\s*$/, "");
  }
  out = out.replace(/,\s*$/, "");

  const stack: ("{" | "[")[] = [];
  let inS = false;
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (esc) { esc = false; continue; }
    if (inS) {
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inS = false; continue; }
      continue;
    }
    if (ch === '"') { inS = true; continue; }
    if (ch === "{") { stack.push("{"); continue; }
    if (ch === "[") { stack.push("["); continue; }
    if (ch === "}" || ch === "]") { stack.pop(); continue; }
  }

  while (true) {
    const trimmed = out.replace(/[\s,]+$/, "");
    const stripped = trimmed.replace(/"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "");
    if (stripped === trimmed) break;
    out = stripped;
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

function repairLikelyJson(input: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "\u201c" || ch === "\u201d") { out += '"'; continue; }
    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === "}" || input[j] === "]") continue;
    }
    if ((ch === "}" || ch === "]") && i + 1 < input.length) {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      const next = input[j];
      if (next === "{" || next === "[") { out += ch + ","; continue; }
    }
    out += ch;
  }
  return out;
}

function tryParseJson<T = unknown>(raw: string): T {
  const fenced = stripJsonFence(raw);
  const candidate = extractBalancedJson(fenced) ?? fenced;

  const stages: Array<{ name: string; fn: (s: string) => string }> = [
    { name: "raw",              fn: (s) => s },
    { name: "repair-likely",   fn: repairLikelyJson },
    { name: "escape-controls", fn: (s) => escapeControlCharsInStrings(repairLikelyJson(s)) },
    { name: "recover-truncated", fn: (s) => recoverTruncatedJson(escapeControlCharsInStrings(repairLikelyJson(s))) },
  ];

  let lastErr: unknown = null;
  for (const { name, fn } of stages) {
    try {
      const parsed = JSON.parse(fn(candidate)) as T;
      if (name !== "raw") console.warn(`[PdfReview] AI JSON recovered via stage: ${name}`);
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const posMatch = msg.match(/position\s+(\d+)/i);
  const pos = posMatch ? Number(posMatch[1]) : -1;
  const snippet =
    pos >= 0
      ? candidate.slice(Math.max(0, pos - 60), Math.min(candidate.length, pos + 60))
      : candidate.slice(0, 200);
  throw new Error(
    `Could not parse AI response as JSON (${msg}). Context near position ${pos}: …${snippet}…`,
  );
}

// ─── Evidence sanitiser ───────────────────────────────────────────────────────
function sanitiseEvidence(raw: unknown): IssueEvidence | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  const compared: IssueEvidenceCompared[] = (Array.isArray(r.compared) ? r.compared : [])
    .map((c): IssueEvidenceCompared | null => {
      if (!c || typeof c !== "object") return null;
      const o = c as Record<string, unknown>;
      const label = typeof o.label === "string" && o.label.trim() ? o.label : null;
      if (!label) return null;
      return {
        label,
        old: typeof o.old === "string" ? o.old : undefined,
        new: typeof o.new === "string" ? o.new : undefined,
      };
    })
    .filter((x): x is IssueEvidenceCompared => x !== null);

  const trace: IssueEvidenceTraceStep[] = (Array.isArray(r.trace) ? r.trace : [])
    .map((t): IssueEvidenceTraceStep | null => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const tag  = typeof o.tag  === "string" && o.tag.trim()  ? o.tag  : null;
      const text = typeof o.text === "string" && o.text.trim() ? o.text : null;
      if (!tag || !text) return null;
      return { tag, text };
    })
    .filter((x): x is IssueEvidenceTraceStep => x !== null);

  let rule: IssueEvidence["rule"];
  if (r.rule && typeof r.rule === "object") {
    const ro = r.rule as Record<string, unknown>;
    const code = typeof ro.code === "string" && ro.code.trim() ? ro.code : null;
    if (code) rule = { code, version: typeof ro.version === "string" ? ro.version : undefined };
  }

  const linkedRecords = (Array.isArray(r.linkedRecords) ? r.linkedRecords : [])
    .filter((x): x is string => typeof x === "string");

  const verdict = typeof r.verdict === "string" && r.verdict.trim() ? r.verdict : undefined;

  if (!compared.length && !trace.length && !rule && !verdict && !linkedRecords.length) {
    return undefined;
  }

  const out: IssueEvidence = {};
  if (compared.length)      out.compared      = compared;
  if (verdict)              out.verdict        = verdict;
  if (rule)                 out.rule           = rule;
  if (trace.length)         out.trace          = trace;
  if (linkedRecords.length) out.linkedRecords  = linkedRecords;
  return out;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
interface ParsedDoc {
  fileName: string;
  score: number;
  summary: string;
  issues: Array<Omit<Issue, "id">>;
  // metadata is now embedded inside each document (not a separate top-level array)
  metadata?: unknown;
}

interface ParsedReview {
  documents: ParsedDoc[];
  overallScore?: number;
  // Legacy: some responses may still have top-level metadata array — kept as fallback
  metadata?: unknown[];
}

const SEVERITIES: IssueSeverity[] = ["error", "warning", "suggestion"];

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Extract a ReportMetadata from a raw object, tolerating missing / null fields */
function extractMetadata(raw: unknown): ReportMetadata {
  const metadataKeys: (keyof ReportMetadata)[] = [
    "reportNo", "ulr", "customer", "sample", "sampleId", "issuedDate",
    "samplingDate", "receiptDate", "analysisStartDate", "analysisEndDate",
    "subLabs", "documentClass", "nabl", "method", "matrix", "version",
  ];
  const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as ReportMetadata;
  for (const k of metadataKeys) {
    out[k] = typeof entry[k] === "string" ? (entry[k] as string) : null;
  }
  return out;
}

export function parseReviewToResult(
  raw: string,
  uploaded: { id: string; name: string }[],
): { result: ReviewResult; metadata: ReportMetadata[] } {
  const parsed = tryParseJson<ParsedReview>(raw);
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];

  // Legacy fallback: top-level metadata array (old schema)
  const legacyMeta = Array.isArray(parsed.metadata) ? parsed.metadata : [];

  const documents = uploaded.map((u, idx) => {
    const match =
      docs.find((d) => d.fileName?.trim() === u.name.trim()) ?? docs[idx];
    const score = clampScore(match?.score);

    const issues = (Array.isArray(match?.issues) ? match!.issues : [])
      .filter(
        (i): i is Omit<Issue, "id"> =>
          !!i &&
          typeof i.title === "string" &&
          SEVERITIES.includes(i.severity as IssueSeverity),
      )
      .map((i, k) => ({
        id: `${u.id}-issue-${k}`,
        severity: i.severity as IssueSeverity,
        // headCode: safely coerce — falls back to undefined if invalid
        headCode: isHeadCode((i as { headCode?: unknown }).headCode)
          ? (i as { headCode: HeadCode }).headCode
          : undefined,
        title: i.title,
        description: i.description ?? "",
        location: i.location ?? "",
        suggestion: i.suggestion ?? "",
        page: typeof i.page === "number" ? i.page : undefined,
        evidence: sanitiseEvidence((i as { evidence?: unknown }).evidence),
      })) satisfies Issue[];

    return {
      fileId: u.id,
      fileName: u.name,
      score,
      summary: match?.summary ?? "",
      issues,
    };
  });

  const overallScore =
    typeof parsed.overallScore === "number"
      ? clampScore(parsed.overallScore)
      : Math.round(
          documents.reduce((s, d) => s + d.score, 0) /
            Math.max(1, documents.length),
        );

  // Extract per-document metadata.
  // NEW schema: metadata is embedded inside each documents[] entry as doc.metadata.
  // LEGACY fallback: if doc.metadata is absent, try the old top-level metadata[] array by index.
  const metadata: ReportMetadata[] = uploaded.map((u, idx) => {
    const match =
      docs.find((d) => d.fileName?.trim() === u.name.trim()) ?? docs[idx];

    // Prefer inline metadata (new schema)
    if (match?.metadata && typeof match.metadata === "object") {
      return extractMetadata(match.metadata);
    }

    // Fallback: old top-level metadata array — try name match then index
    const legacyByName = legacyMeta.find(
      (m) => m && typeof (m as Record<string, unknown>).fileName === "string"
        && ((m as Record<string, unknown>).fileName as string).trim() === u.name.trim()
    );
    return extractMetadata(legacyByName ?? legacyMeta[idx]);
  });

  return {
    result: {
      documents,
      overallScore,
      reviewedAt: new Date().toISOString(),
    },
    metadata,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────
export async function runPdfReview(
  uploaded: { id: string; name: string; file: File }[],
  signal?: AbortSignal,
): Promise<{ result: ReviewResult; correlationId: string; model: string; metadata: ReportMetadata[] }> {
  const correlationId = newCorrelationId();

  // Single call — review findings + report metadata extracted together in one PDF read
  const success = await reviewPdfs(
    {
      files: uploaded.map((u) => u.file),
      prompt: STRUCTURED_PROMPT,
      correlationId,
      deleteFilesAfter: true,
    },
    signal,
  );

  const { result, metadata } = parseReviewToResult(
    success.review,
    uploaded.map((u) => ({ id: u.id, name: u.name })),
  );

  return { result, correlationId: success.correlationId, model: success.model, metadata };
}