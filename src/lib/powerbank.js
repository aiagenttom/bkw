/**
 * Powerbank / Batteriespeicher – Simulationslogik
 *
 * Modell pro Tag (Battery startet leer oder mit initialSocWh):
 *   Jede Stunde:
 *   1. Direkter Eigenverbrauch = min(PV-Ertrag, Verbrauchsprofil)
 *   2. Überschuss-PV lädt den Speicher (bis Kapazität)
 *   3. Speicher gibt konstant discharge_w W ab – aber NUR im Zeitfenster
 *      discharge_start … discharge_end (HH:MM, z.B. "05:00"–"22:30")
 *   4. Batterie-Eigenverbrauch = der Teil der Entladung, der noch ungedeckten
 *      Verbrauch (Profil − direkter EV) abdeckt
 *
 * Rückgabe: zusätzliche Ersparnis in EUR, die durch den Speicher entsteht
 * (ON TOP der bereits berechneten Profil-Ersparnis aus direktem EV).
 */

/**
 * @typedef {{\
 *   hour:      number,   // Stunde des Tages (0–23)
 *   yieldWh:   number,   // PV-Ertrag dieser Stunde in Wh
 *   profileWh: number,   // Verbrauch laut Profil in Wh
 *   priceCt:   number,   // Preis in ct/kWh (OHNE MwSt/Netzgebühr)
 * }} HourlyEntry
 */

/**
 * Wandelt "HH:MM" in Minuten seit Mitternacht um.
 * @param {string} hhmm
 * @returns {number}
 */
function toMin(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Simuliert einen Speicher für einen Tag und gibt die zusätzliche Ersparnis zurück.
 *
 * @param {HourlyEntry[]} hourlyData    - Stunden mit Ertrag, Profil und Preis
 * @param {number}        capacityWh   - Speicherkapazität in Wh
 * @param {number}        dischargeW   - Konstante Abgabeleistung in W (= Wh pro Stunde)
 * @param {number}        netzCt       - Netzgebühr in ct/kWh
 * @param {number}        mwstPct      - MwSt in %
 * @param {number}        [initialSocWh=0]   - Vorgeladener SOC zu Tagesbeginn in Wh
 * @param {string}        [dischargeStart='00:00'] - Beginn des Entlade-Fensters (HH:MM)
 * @param {string}        [dischargeEnd='23:59']   - Ende  des Entlade-Fensters (HH:MM)
 * @returns {number}  Zusätzliche Ersparnis in EUR
 */
export function simulatePowerbankSavings(
  hourlyData, capacityWh, dischargeW, netzCt, mwstPct,
  initialSocWh = 0,
  dischargeStart = '00:00',
  dischargeEnd   = '23:59',
) {
  let soc = Math.min(initialSocWh, capacityWh);
  let additionalEur = 0;

  const startMin = toMin(dischargeStart);
  const endMin   = toMin(dischargeEnd);

  for (const { hour, yieldWh, profileWh, priceCt } of hourlyData) {
    // 1. Direkter Eigenverbrauch PV → Haushalt
    const directEigen = Math.min(yieldWh, profileWh);

    // 2. Überschuss-PV lädt Speicher
    const excessPv = Math.max(0, yieldWh - directEigen);
    const chargeWh = Math.min(excessPv, capacityWh - soc);
    soc = Math.min(soc + chargeWh, capacityWh);

    // 3. Speicher darf nur im Zeitfenster entladen.
    //    Stunde h deckt Minuten [h×60, (h+1)×60).
    //    Überlappung mit Fenster [startMin, endMin) prüfen.
    const hStart = (hour ?? 0) * 60;
    const hEnd   = hStart + 60;
    const canDischarge = hStart < endMin && hEnd > startMin;

    const dischargeWh = canDischarge ? Math.min(dischargeW, soc) : 0;
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
 * @returns {Map<number, {capacityWh: number, dischargeW: number, dischargeStart: string, dischargeEnd: string}>}
 *   Key: inverter_id
 */
export function loadPowerbanks(db) {
  const rows = db.prepare(
    'SELECT inverter_id, capacity_wh, discharge_w, discharge_start, discharge_end FROM powerbanks WHERE enabled = 1'
  ).all();
  const map = new Map();
  for (const r of rows) map.set(r.inverter_id, {
    capacityWh:    r.capacity_wh,
    dischargeW:    r.discharge_w,
    dischargeStart: r.discharge_start ?? '00:00',
    dischargeEnd:   r.discharge_end   ?? '23:59',
  });
  return map;
}
