/**
 * Powerbank / Batteriespeicher – Simulationslogik
 *
 * Modell pro Tag (Battery startet leer):
 *   Jede Stunde:
 *   1. Direkter Eigenverbrauch = min(PV-Ertrag, Verbrauchsprofil)
 *   2. Überschuss-PV lädt den Speicher (bis Kapazität)
 *   3. Speicher gibt konstant discharge_w W ab
 *   4. Batterie-Eigenverbrauch = der Teil der Entladung, der noch ungedeckten
 *      Verbrauch (Profil − direkter EV) abdeckt
 *
 * Rückgabe: zusätzliche Ersparnis in EUR, die durch den Speicher entsteht
 * (ON TOP der bereits berechneten Profil-Ersparnis aus direktem EV).
 */

/**
 * @typedef {{
 *   yieldWh:   number,   // PV-Ertrag dieser Stunde in Wh
 *   profileWh: number,   // Verbrauch laut Profil in Wh
 *   priceCt:   number,   // Preis in ct/kWh (OHNE MwSt/Netzgebühr)
 * }} HourlyEntry
 */

/**
 * Simuliert einen Speicher für einen Tag und gibt die zusätzliche Ersparnis zurück.
 *
 * @param {HourlyEntry[]} hourlyData  - Stunden mit Ertrag, Profil und Preis
 * @param {number}        capacityWh  - Speicherkapazität in Wh
 * @param {number}        dischargeW  - Konstante Abgabeleistung in W (= Wh pro Stunde)
 * @param {number}        netzCt      - Netzgebühr in ct/kWh
 * @param {number}        mwstPct     - MwSt in %
 * @returns {number}  Zusätzliche Ersparnis in EUR
 */
export function simulatePowerbankSavings(hourlyData, capacityWh, dischargeW, netzCt, mwstPct) {
  let soc = 0; // State of Charge in Wh — startet jeden Tag leer
  let additionalEur = 0;

  for (const { yieldWh, profileWh, priceCt } of hourlyData) {
    // 1. Direkter Eigenverbrauch PV → Haushalt
    const directEigen = Math.min(yieldWh, profileWh);

    // 2. Überschuss-PV lädt Speicher
    const excessPv  = Math.max(0, yieldWh - directEigen);
    const chargeWh  = Math.min(excessPv, capacityWh - soc);
    soc = Math.min(soc + chargeWh, capacityWh);

    // 3. Speicher gibt konstant dischargeW W ab (wenn geladen)
    const dischargeWh = Math.min(dischargeW, soc);
    soc -= dischargeWh;

    // 4. Speicher deckt restlichen, durch PV nicht gedeckten Verbrauch
    const remainingConsumption = Math.max(0, profileWh - directEigen);
    const batteryEigenWh       = Math.min(dischargeWh, remainingConsumption);

    if (batteryEigenWh > 0 && priceCt != null) {
      const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
      additionalEur += batteryEigenWh / 1000 * totalCtPerKwh / 100;
    }
  }

  return additionalEur;
}

/**
 * Lädt alle aktiven Powerbanks aus der DB und gibt sie als Map zurück.
 * Braucht eine better-sqlite3 DB-Instanz.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<number, {capacityWh: number, dischargeW: number}>}
 *   Key: inverter_id
 */
export function loadPowerbanks(db) {
  const rows = db.prepare(
    'SELECT inverter_id, capacity_wh, discharge_w FROM powerbanks WHERE enabled = 1'
  ).all();
  const map = new Map();
  for (const r of rows) map.set(r.inverter_id, { capacityWh: r.capacity_wh, dischargeW: r.discharge_w });
  return map;
}
