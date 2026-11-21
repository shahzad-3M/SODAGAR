import React, { useMemo, useState } from 'react';
import { MapPin, Navigation, Home, Building2, Lock, Zap, CheckCircle2, Globe2 } from 'lucide-react';
import { DeliveryCityConfig } from '../types/index.ts';
import {
  getOrderedProvincesFromCities,
  inferProvinceForCity,
  isMuzaffarabadCity,
  normalizeTextKey,
} from '../utils/locationCategoryHelpers.ts';

interface AddressFieldsGroupProps {
  cities: DeliveryCityConfig[];
  city: string;
  area?: string;
  mohalla?: string;
  landmark?: string;
  address?: string;
  onChange: (patch: {
    city?: string;
    area?: string;
    mohalla?: string;
    landmark?: string;
    address?: string;
  }) => void;
  filterActiveCitiesOnly?: boolean;
  deliveryMode?: 'express_locked' | 'all_open' | 'legacy';
  showCompleteAddress?: boolean;
  required?: boolean;
  compact?: boolean;
}

export const AddressFieldsGroup: React.FC<AddressFieldsGroupProps> = ({
  cities,
  city,
  area = '',
  mohalla = '',
  landmark = '',
  address = '',
  onChange,
  filterActiveCitiesOnly = true,
  deliveryMode = 'legacy',
  showCompleteAddress = true,
  required = false,
  compact = false,
}) => {
  const [customAreaMode, setCustomAreaMode] = useState(false);
  const [provinceFilter, setProvinceFilter] = useState<string>('ALL');

  const visibleCities = useMemo(() => {
    let base: DeliveryCityConfig[];
    if (deliveryMode === 'all_open' || deliveryMode === 'express_locked') {
      base = cities;
    } else {
      base = filterActiveCitiesOnly ? cities.filter((c) => c.allowed) : cities;
    }
    if (city && !base.some((c) => normalizeTextKey(c.name) === normalizeTextKey(city))) {
      return [
        ...base,
        {
          id: `legacy_${city}`,
          name: city,
          province: inferProvinceForCity(city),
          allowed: deliveryMode !== 'express_locked',
          areas: [],
        },
      ];
    }
    return base;
  }, [cities, city, filterActiveCitiesOnly, deliveryMode]);

  const orderedProvinces = useMemo(
    () => getOrderedProvincesFromCities(visibleCities),
    [visibleCities]
  );

  const selectedCityObj = useMemo(
    () => visibleCities.find((c) => normalizeTextKey(c.name) === normalizeTextKey(city)),
    [visibleCities, city]
  );

  const effectiveProvinceFilter =
    provinceFilter !== 'ALL' && orderedProvinces.includes(provinceFilter)
      ? provinceFilter
      : 'ALL';

  const citiesInActiveScope = useMemo(() => {
    if (effectiveProvinceFilter === 'ALL') return visibleCities;
    return visibleCities.filter(
      (c) => inferProvinceForCity(c.name, c.province) === effectiveProvinceFilter
    );
  }, [visibleCities, effectiveProvinceFilter]);

  const groupedByProvince = useMemo(() => {
    const groups = new Map<string, DeliveryCityConfig[]>();
    for (const p of orderedProvinces) {
      groups.set(p, []);
    }
    for (const c of citiesInActiveScope) {
      const p = inferProvinceForCity(c.name, c.province);
      const list = groups.get(p) || [];
      list.push(c);
      groups.set(p, list);
    }
    return Array.from(groups.entries()).filter(([, list]) => list.length > 0);
  }, [citiesInActiveScope, orderedProvinces]);

  const cityAreas = useMemo(() => {
    const rawAreas = selectedCityObj?.areas || [];
    if (deliveryMode === 'all_open' || deliveryMode === 'express_locked') {
      return rawAreas;
    }
    return rawAreas.filter((a) => (filterActiveCitiesOnly ? a.allowed : true));
  }, [selectedCityObj, filterActiveCitiesOnly, deliveryMode]);

  const hasMatchingPredefinedArea = useMemo(
    () => Boolean(area && cityAreas.some((a) => normalizeTextKey(a.name) === normalizeTextKey(area))),
    [area, cityAreas]
  );

  const allowCustomAreaTyping = !(deliveryMode === 'express_locked' && cityAreas.length > 0);
  const useManualArea =
    (allowCustomAreaTyping && customAreaMode) || (cityAreas.length === 0 && Boolean(city));

  const fieldCls =
    'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400';

  const isSelectedCityLockedForExpress =
    deliveryMode === 'express_locked' &&
    Boolean(selectedCityObj) &&
    !isMuzaffarabadCity(selectedCityObj?.name) &&
    !selectedCityObj?.allowed;

  const selectedAreaObj = cityAreas.find((a) => normalizeTextKey(a.name) === normalizeTextKey(area));
  const isSelectedAreaLockedForExpress =
    deliveryMode === 'express_locked' &&
    cityAreas.length > 0 &&
    (!selectedAreaObj || !selectedAreaObj.allowed);

  const activeCityProvince = selectedCityObj
    ? inferProvinceForCity(selectedCityObj.name, selectedCityObj.province)
    : city
    ? inferProvinceForCity(city)
    : '';

  const handleProvinceChange = (nextProv: string) => {
    setProvinceFilter(nextProv);
    if (nextProv === 'ALL') return;
    const provCities = visibleCities.filter(
      (c) => inferProvinceForCity(c.name, c.province) === nextProv
    );
    if (provCities.length === 0) return;
    const currentStillInProv = provCities.some(
      (c) => normalizeTextKey(c.name) === normalizeTextKey(city)
    );
    if (!currentStillInProv) {
      const preferred =
        deliveryMode === 'express_locked'
          ? provCities.find((c) => isMuzaffarabadCity(c.name) || c.allowed) || provCities[0]
          : provCities[0];
      if (preferred) {
        const nextAreas = (preferred.areas || []).filter((a) =>
          deliveryMode === 'express_locked' ? a.allowed : true
        );
        setCustomAreaMode(false);
        onChange({
          city: preferred.name,
          area: nextAreas[0]?.name || '',
        });
      }
    }
  };

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      {deliveryMode === 'express_locked' && (
        <div
          className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold flex items-center gap-1.5 ${
            isSelectedCityLockedForExpress || isSelectedAreaLockedForExpress
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
          }`}
        >
          {isSelectedCityLockedForExpress || isSelectedAreaLockedForExpress ? (
            <>
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Express items deliver ONLY in manually unlocked cities &amp; sub-cities. Other provinces/cities remain locked (🔒).
              </span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>
                Express Unlocked: Instant delivery active in manually selected cities &amp; sub-cities (others locked 🔒).
              </span>
            </>
          )}
        </div>
      )}

      {deliveryMode === 'all_open' && (
        <div className="px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200 text-[10px] font-semibold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>
            All Provinces &amp; Kashmir Open — Standard 3 to 6 Working Days Promised Delivery (Major Cities, Sub-Cities, Child Cities &amp; Villages).
          </span>
        </div>
      )}

      {/* Province / Region Filter Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
            <Globe2 className="w-3.5 h-3.5 text-amber-500" />
            <span>Province / Kashmir (صوبہ)</span>
          </label>
          <select
            value={effectiveProvinceFilter}
            onChange={(e) => handleProvinceChange(e.target.value)}
            className={fieldCls}
          >
            <option value="ALL">All Provinces &amp; Kashmir ({visibleCities.length})</option>
            {orderedProvinces.map((prov) => {
              const count = visibleCities.filter(
                (c) => inferProvinceForCity(c.name, c.province) === prov
              ).length;
              return (
                <option key={prov} value={prov}>
                  {prov} ({count})
                </option>
              );
            })}
          </select>
        </div>

        {/* Major City / District Dropdown */}
        <div>
          <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between gap-1">
            <span className="flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-amber-500" />
              <span>City / District (شہر) {required && '*'}</span>
            </span>
            {activeCityProvince && (
              <span className="text-[9px] font-semibold text-slate-400 truncate max-w-[95px]">
                {activeCityProvince}
              </span>
            )}
          </label>
          <select
            required={required}
            value={city}
            onChange={(e) => {
              const nextCity = e.target.value;
              const nextCityObj = visibleCities.find(
                (c) => normalizeTextKey(c.name) === normalizeTextKey(nextCity)
              );
              const nextAreas = (nextCityObj?.areas || []).filter((a) =>
                deliveryMode === 'express_locked'
                  ? a.allowed
                  : deliveryMode === 'all_open'
                  ? true
                  : filterActiveCitiesOnly
                  ? a.allowed
                  : true
              );
              setCustomAreaMode(false);
              onChange({
                city: nextCity,
                area: nextAreas[0]?.name || '',
              });
            }}
            className={fieldCls}
          >
            <option value="">-- Select City / District --</option>
            {effectiveProvinceFilter === 'ALL'
              ? groupedByProvince.map(([provLabel, provCities]) => (
                  <optgroup key={provLabel} label={provLabel}>
                    {provCities.map((c) => {
                      const isLockedForExpress =
                        deliveryMode === 'express_locked' &&
                        !isMuzaffarabadCity(c.name) &&
                        !c.allowed;
                      return (
                        <option key={c.id || c.name} value={c.name} disabled={isLockedForExpress}>
                          {isLockedForExpress ? '🔒 ' : ''}
                          {c.name}
                          {typeof c.deliveryCharge === 'number' ? ` (Rs. ${c.deliveryCharge})` : ''}
                          {isLockedForExpress
                            ? ' — Express Locked'
                            : deliveryMode === 'legacy' && !c.allowed
                            ? ' (Delivery Disabled)'
                            : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))
              : citiesInActiveScope.map((c) => {
                  const isLockedForExpress =
                    deliveryMode === 'express_locked' &&
                    !isMuzaffarabadCity(c.name) &&
                    !c.allowed;
                  return (
                    <option key={c.id || c.name} value={c.name} disabled={isLockedForExpress}>
                      {isLockedForExpress ? '🔒 ' : ''}
                      {c.name}
                      {typeof c.deliveryCharge === 'number' ? ` (Rs. ${c.deliveryCharge})` : ''}
                      {isLockedForExpress
                        ? ' — Express Locked'
                        : deliveryMode === 'legacy' && !c.allowed
                        ? ' (Delivery Disabled)'
                        : ''}
                    </option>
                  );
                })}
          </select>
        </div>

        {/* Dynamic Sub-City / Child City / Tehsil / Village Dropdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-amber-500" />
              <span>
                Sub-City / Child City / Village{' '}
                {deliveryMode === 'express_locked' && cityAreas.length > 0 ? '' : '(Optional)'}
              </span>
            </label>
            {cityAreas.length > 0 && allowCustomAreaTyping && (
              <button
                type="button"
                onClick={() => setCustomAreaMode(!customAreaMode)}
                className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer shrink-0"
              >
                {customAreaMode ? 'From list' : 'Exact Village'}
              </button>
            )}
          </div>

          {!useManualArea ? (
            <select
              value={area}
              onChange={(e) => {
                if (e.target.value === '__OTHER__') {
                  setCustomAreaMode(true);
                  onChange({ area: '' });
                } else {
                  onChange({ area: e.target.value });
                }
              }}
              className={fieldCls}
            >
              <option value="">
                -- {deliveryMode === 'express_locked' && cityAreas.length > 0 ? 'Select Unlocked' : 'Optional: Select'} Sub-City / Village in {city || 'City'} --
              </option>
              {cityAreas.map((a) => {
                const isAreaLocked = deliveryMode === 'express_locked' && !a.allowed;
                return (
                  <option key={a.id} value={a.name} disabled={isAreaLocked}>
                    {isAreaLocked ? '🔒 ' : ''}
                    {a.name}
                    {typeof a.deliveryCharge === 'number' ? ` — Rs. ${a.deliveryCharge}` : ''}
                    {isAreaLocked ? ' (Locked)' : ''}
                  </option>
                );
              })}
              {area && !hasMatchingPredefinedArea && allowCustomAreaTyping && (
                <option value={area}>{area} (Saved)</option>
              )}
              {allowCustomAreaTyping && <option value="__OTHER__">+ Type Exact Village / Area Manually</option>}
            </select>
          ) : (
            <input
              type="text"
              value={area}
              onChange={(e) => onChange({ area: e.target.value })}
              placeholder={city ? `Enter sub-city, tehsil or village in ${city}` : 'Enter exact village / area name'}
              className={fieldCls}
            />
          )}
        </div>
      </div>

      {/* Village / Mohalla & Nearby Landmark */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
            <Home className="w-3.5 h-3.5 text-amber-500" />
            <span>Village / Mohalla / Chak (گاؤں / محلہ / کالونی)</span>
          </label>
          <input
            type="text"
            value={mohalla}
            onChange={(e) => onChange({ mohalla: e.target.value })}
            placeholder="e.g. Village Chak 45 / Mohalla Eidgah / Block B"
            className={fieldCls}
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
            <Navigation className="w-3.5 h-3.5 text-amber-500" />
            <span>Nearby Landmark / Tehsil (قریبی مشہور جگہ)</span>
          </label>
          <input
            type="text"
            value={landmark}
            onChange={(e) => onChange({ landmark: e.target.value })}
            placeholder="e.g. Near Main Chowk / Jamia Masjid / Stop"
            className={fieldCls}
          />
        </div>
      </div>

      {/* Complete Address */}
      {showCompleteAddress && (
        <div>
          <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
            Complete Address / House, Village &amp; Street Details {required && '*'}
          </label>
          <input
            type="text"
            required={required}
            value={address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="House / Shop #, Village / Mohalla, Post Office, Tehsil & Delivery Instructions"
            className={fieldCls}
          />
        </div>
      )}
    </div>
  );
};

