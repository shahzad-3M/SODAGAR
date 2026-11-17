import React, { useMemo, useState } from 'react';
import { MapPin, Navigation, Home, Building2, Lock, Zap, CheckCircle2 } from 'lucide-react';
import { DeliveryCityConfig } from '../types';
import { isMuzaffarabadCity, normalizeTextKey } from '../utils/locationCategoryHelpers';

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

  const visibleCities = useMemo(() => {
    if (deliveryMode === 'all_open' || deliveryMode === 'express_locked') {
      if (city && !cities.some((c) => normalizeTextKey(c.name) === normalizeTextKey(city))) {
        return [...cities, { id: `legacy_${city}`, name: city, allowed: false, areas: [] }];
      }
      return cities;
    }
    const base = filterActiveCitiesOnly ? cities.filter((c) => c.allowed) : cities;
    if (city && !base.some((c) => normalizeTextKey(c.name) === normalizeTextKey(city))) {
      return [...base, { id: `legacy_${city}`, name: city, allowed: true, areas: [] }];
    }
    return base;
  }, [cities, city, filterActiveCitiesOnly, deliveryMode]);

  const selectedCityObj = useMemo(
    () => cities.find((c) => normalizeTextKey(c.name) === normalizeTextKey(city)),
    [cities, city]
  );

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
                Express items deliver ONLY in manually unlocked cities &amp; sub-cities. Other cities/sub-cities remain locked (🔒).
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
            Open across all cities &amp; sub-cities — Delivery in 3 to 6 working days depending on logistics.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* City Dropdown */}
        <div>
          <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-amber-500" />
            <span>City / شہر {required && '*'}</span>
          </label>
          <select
            required={required}
            value={city}
            onChange={(e) => {
              const nextCity = e.target.value;
              const nextCityObj = cities.find(
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
            <option value="">-- Select City --</option>
            {visibleCities.map((c) => {
              const isLockedForExpress =
                deliveryMode === 'express_locked' && !isMuzaffarabadCity(c.name) && !c.allowed;
              const isDisabled = isLockedForExpress;
              return (
                <option key={c.id || c.name} value={c.name} disabled={isDisabled}>
                  {isLockedForExpress ? '🔒 ' : ''}
                  {c.name}
                  {typeof c.deliveryCharge === 'number' ? ` (Rs. ${c.deliveryCharge})` : ''}
                  {isLockedForExpress
                    ? ' — Locked (Express OFF)'
                    : deliveryMode === 'legacy' && !c.allowed
                    ? ' (Delivery Disabled)'
                    : ''}
                </option>
              );
            })}
          </select>
        </div>

        {/* Dynamic Area / Sub-City Dropdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-amber-500" />
              <span>Sub-City / Area Name (علاقہ)</span>
            </label>
            {cityAreas.length > 0 && allowCustomAreaTyping && (
              <button
                type="button"
                onClick={() => setCustomAreaMode(!customAreaMode)}
                className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                {customAreaMode ? 'Choose from list' : 'Other area'}
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
              <option value="">-- Select Sub-City / Area in {city || 'City'} --</option>
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
              {allowCustomAreaTyping && <option value="__OTHER__">+ Type Area Manually</option>}
            </select>
          ) : (
            <input
              type="text"
              value={area}
              onChange={(e) => onChange({ area: e.target.value })}
              placeholder={city ? `Enter area in ${city}` : 'Enter area name'}
              className={fieldCls}
            />
          )}
        </div>
      </div>

      {/* Mohalla & Nearby Landmark */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
            <Home className="w-3.5 h-3.5 text-amber-500" />
            <span>Mohalla / Neighborhood (محلہ / کالونی)</span>
          </label>
          <input
            type="text"
            value={mohalla}
            onChange={(e) => onChange({ mohalla: e.target.value })}
            placeholder="e.g. Mohalla Eidgah / Street 4 / Block B"
            className={fieldCls}
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
            <Navigation className="w-3.5 h-3.5 text-amber-500" />
            <span>Nearby Landmark (قریبی مشہور جگہ)</span>
          </label>
          <input
            type="text"
            value={landmark}
            onChange={(e) => onChange({ landmark: e.target.value })}
            placeholder="e.g. Near Jamia Masjid / Main Gate"
            className={fieldCls}
          />
        </div>
      </div>

      {/* Complete Address */}
      {showCompleteAddress && (
        <div>
          <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
            Complete Address / House &amp; Shop No. {required && '*'}
          </label>
          <input
            type="text"
            required={required}
            value={address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="House / Shop #, Road, Floor or Delivery Instructions"
            className={fieldCls}
          />
        </div>
      )}
    </div>
  );
};
